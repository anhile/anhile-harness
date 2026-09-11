#!/usr/bin/env node
// @ts-check
/**
 * The gate's witness: ./verify.sh runs every step and writes complete
 * evidence for a failing run as well as a passing one.
 *
 * This deliberately lives OUTSIDE verify.sh. It runs verify.sh twice, so making
 * it a verify.sh step would recurse forever. That is not a gap in coverage but
 * the shape of the problem: a gate cannot be its own witness.
 *
 * Run it by hand, or in CI as a step separate from verify.sh:
 *
 *   node scripts/check-verify.mjs
 *
 * It leaves the working tree exactly as it found it, including on failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { readRuns } from './verify-log.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(root, '.generated', 'runs');
const PROBE = path.join(root, loadConfig().verifyProbe.path);

/**
 * The steps the gate runs, read from the gate. This used to be a literal list
 * of nine, written when every project had all nine; the generator writes a
 * gate with the steps a project can pass, so the witness of a six-step gate
 * demanded evidence for three steps that were never there and failed on a
 * green run. What a step is called is decided in one place, verify.sh, and
 * the witness asks it.
 */
const EXPECTED_STEPS = readFileSync(path.join(root, 'verify.sh'), 'utf8')
  .split('\n')
  .flatMap((line) => {
    const m = /^run_step (\d\d) (\S+)/u.exec(line);
    return m === null ? [] : [`${m[1]}-${m[2]}`];
  });
if (EXPECTED_STEPS.length === 0) {
  console.error('check-verify: verify.sh has no run_step lines, so there is nothing to witness');
  process.exit(1);
}
// The deliberate error below is a type error, so the step it breaks has to be
// in the gate for the witness to mean anything.
if (!EXPECTED_STEPS.includes('02-typecheck')) {
  console.error('check-verify: verify.sh has no 02-typecheck step, which the deliberate error targets');
  process.exit(1);
}

let failures = 0;
/**
 * @param {string} description
 * @param {boolean} condition
 * @param {string} [detail]
 */
function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${description}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${description}${detail ? `\n        ${detail}` : ''}`);
  }
}

function runVerify() {
  try {
    execFileSync('./verify.sh', { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (error) {
    return /** @type {{ status?: number }} */ (error).status ?? 1;
  }
}

function newestEvidenceDir() {
  const dirs = readdirSync(EVIDENCE).filter((name) => /^\d{8}T\d{6}Z$/.test(name)).sort();
  const newest = dirs[dirs.length - 1];
  if (newest === undefined) throw new Error(`no evidence folder under ${EVIDENCE}`);
  return path.join(EVIDENCE, newest);
}

/**
 * @param {string} dir
 * @param {{ expectFailure: boolean }} options
 */
function auditEvidence(dir, { expectFailure }) {
  for (const step of EXPECTED_STEPS) {
    check(`${path.basename(dir)} has ${step}.log`, existsSync(path.join(dir, `${step}.log`)));
    check(`${path.basename(dir)} has ${step}.exit`, existsSync(path.join(dir, `${step}.exit`)));
  }
  const summaryPath = path.join(dir, 'summary.txt');
  check(`${path.basename(dir)} has summary.txt`, existsSync(summaryPath));

  // steps.jsonl is what verify-log.mjs reads to build the durable record, so an
  // incomplete one means the record of this run is incomplete too.
  const stepsPath = path.join(dir, 'steps.jsonl');
  check(`${path.basename(dir)} has steps.jsonl`, existsSync(stepsPath));
  if (existsSync(stepsPath)) {
    const recorded = readFileSync(stepsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).step);
    check(
      'steps.jsonl records every step that ran',
      EXPECTED_STEPS.every((step) => recorded.includes(step)),
      `recorded: ${recorded.join(', ')}`,
    );
  }

  const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '';
  if (expectFailure) {
    check('summary records the failing step', /FAIL\s+02 typecheck/.test(summary), summary.trim());
    check('summary verdict is FAIL', /RESULT: FAIL/.test(summary));
    // The point of the feature: later steps still ran.
    const after = EXPECTED_STEPS.slice(EXPECTED_STEPS.indexOf('02-typecheck') + 1);
    check(
      'steps after the failure still produced logs',
      after.every((step) =>
        /PASS|FAIL/.test(summary.match(new RegExp(`^(PASS|FAIL)\\s+${step.slice(0, 2)} `, 'm'))?.[0] ?? ''),
      ),
      summary.trim(),
    );
  } else {
    check('summary verdict is PASS', /RESULT: PASS/.test(summary), summary.trim());
  }
}

/** Runs currently in the durable record. */
function loggedRuns() {
  return readRuns();
}

/** @returns {import('./verify-log.mjs').Run | null} */
function lastLoggedRun() {
  return loggedRuns().at(-1) ?? null;
}

console.log('1/2  clean tree: verify.sh must exit 0 with complete evidence');
let runsBefore = loggedRuns().length;
const cleanStatus = runVerify();
check('exit code is 0', cleanStatus === 0, `got ${cleanStatus}`);
auditEvidence(newestEvidenceDir(), { expectFailure: false });
check('the run was recorded under verify-log/', loggedRuns().length === runsBefore + 1,
  `${runsBefore} -> ${loggedRuns().length}`);
check('the recorded verdict is pass', lastLoggedRun()?.result === 'pass',
  JSON.stringify(lastLoggedRun()?.result));

console.log('\n2/2  deliberate type error: verify.sh must exit non-zero, evidence still complete');
writeFileSync(PROBE, "export const broken: number = 'not a number';\n");
try {
  runsBefore = loggedRuns().length;
  const brokenStatus = runVerify();
  check('exit code is non-zero', brokenStatus !== 0, `got ${brokenStatus}`);
  auditEvidence(newestEvidenceDir(), { expectFailure: true });
  // The point of the durable record: a red run leaves a trace too. A log that
  // only ever gains green lines would let a session fail quietly and try again.
  check('the failing run was appended too', loggedRuns().length === runsBefore + 1,
    `${runsBefore} -> ${loggedRuns().length}`);
  check('the recorded verdict is fail', lastLoggedRun()?.result === 'fail',
    JSON.stringify(lastLoggedRun()?.result));
  check('the recorded run names the failing step',
    lastLoggedRun()?.steps?.['02-typecheck']?.exit !== 0,
    JSON.stringify(lastLoggedRun()?.steps));
} finally {
  rmSync(PROBE, { force: true });
}

console.log('\n3/3  the probe is gone and the tree verifies again');
check('probe file removed', !existsSync(PROBE));
const restoredStatus = runVerify();
check('exit code is 0 again', restoredStatus === 0, `got ${restoredStatus}`);

console.log('');
if (failures > 0) {
  console.error(`check-verify: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('check-verify: ok');
