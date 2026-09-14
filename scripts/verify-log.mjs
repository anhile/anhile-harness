#!/usr/bin/env node
// @ts-check
/**
 * verify-log/ — the durable record of what ./verify.sh concluded, one file
 * per run.
 *
 * The raw evidence under .generated/runs/ stays out of git: it weighs
 * megabytes, carries one machine's paths and timings, and none of it survives
 * a clone. What goes into history instead is one small file per run: the
 * verdict, every step's exit code and duration, and the hash of the tree it
 * ran against. The file is named after the run's evidence folder, so two runs
 * cannot share a name and a run's file never changes once written.
 *
 * **Every run is recorded, including failures.** A record that keeps only the
 * green runs lies by omission, and the repository this harness came from had
 * the failure mode to prove it: two commits made on a red verify.sh left no
 * durable trace at all. Red runs are also where the useful signal is -- a
 * step that fails one run in five is invisible until someone can count.
 *
 * **Append-only, on the same reasoning as feature_list.json:** a session that
 * can rewrite the record of its own verification can say anything about it.
 * Here that means a recorded run's file is never edited and never removed;
 * `check` compares every file at the baseline with the same file now.
 *
 * **One file per run, not one line per run, since 2026-09-12.** The record
 * was a single append-only verify-log.jsonl for its first two weeks. Two
 * branches that both ran the gate both appended to its end, so every merge
 * of two working branches conflicted in that file, and the rule that fixed
 * the conflicts — a branch's newest run must be newer than main's, rerun the
 * gate before every merge — was a tax on parallel work that nothing else
 * asked for. GitHub does not honour a union merge for pull requests, so the
 * file itself had to stop being one file. Files with distinct names never
 * conflict, and "append-only" for a directory is a rule git can state in one
 * command: nothing modified, nothing deleted.
 *
 * Usage:
 *   node scripts/verify-log.mjs append --evidence <dir>
 *   node scripts/verify-log.mjs check [--base <ref>] [--at <ref>]
 *   node scripts/verify-log.mjs tail [n]
 *   node scripts/verify-log.mjs flakes [days]
 *   node scripts/verify-log.mjs migrate     # verify-log.jsonl, from before 2026-09-12, into files
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReceipt } from './verify-receipt.mjs';
import { AUDIT_DIR, logProblems as auditProblems, filesAt as auditsAt, currentFiles as currentAudits } from './audit-log.mjs';

/**
 * One recorded run, as the receipt described it.
 * @typedef {{
 *   at: string,
 *   result: 'pass' | 'fail' | 'stale' | string,
 *   tree: string | null,
 *   head: string | null,
 *   branch: string | null,
 *   node: string,
 *   evidence: string,
 *   steps: Record<string, { exit: number, seconds: number }>,
 * }} Run
 */

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const LOG_DIR = 'verify-log';

/** A run's file is named after its evidence folder: the UTC timestamp verify.sh started at. */
export const RUN_FILE = /^(\d{8}T\d{6}Z)\.json$/u;

const REQUIRED = ['at', 'result', 'tree', 'steps'];

/** The moment a run started, from its id. */
const startedAt = (/** @type {string} */ id) =>
  new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`);

const logDir = () => path.join(root, LOG_DIR);

/**
 * The run files in a directory listing, oldest first. Names are what they
 * are sorted by, and a name is a timestamp, so order is chronological.
 * @param {string[]} names
 */
const runFiles = (names) => names.filter((n) => RUN_FILE.test(n)).sort();

/**
 * The record as it stands in the working tree: file name to contents.
 * @returns {Map<string, string>}
 */
export function currentFiles() {
  if (!existsSync(logDir())) return new Map();
  return new Map(runFiles(readdirSync(logDir())).map((n) => [n, readFileSync(path.join(logDir(), n), 'utf8')]));
}

/**
 * The record as it stood at a commit: file name to contents. Empty when the
 * directory did not exist there.
 * @param {string} ref
 * @returns {Map<string, string>}
 */
export function filesAt(ref) {
  let listing;
  try {
    listing = execFileSync('git', ['ls-tree', '--name-only', `${ref}:${LOG_DIR}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return new Map();
  }
  return new Map(
    runFiles(listing.split('\n')).map((n) => [
      n,
      execFileSync('git', ['show', `${ref}:${LOG_DIR}/${n}`], { cwd: root, encoding: 'utf8' }),
    ]),
  );
}

/**
 * The recorded runs, oldest first, from the working tree or from a commit.
 * A file that does not parse is skipped here and refused by `check`.
 * @param {string} [ref]
 * @returns {Run[]}
 */
export function readRuns(ref) {
  /** @type {Run[]} */
  const runs = [];
  for (const text of (ref === undefined ? currentFiles() : filesAt(ref)).values()) {
    try {
      runs.push(JSON.parse(text));
    } catch {
      /* the guard's business */
    }
  }
  return runs;
}

/**
 * Reads the per-step results verify.sh recorded for one run.
 * @param {string} evidenceDir
 * @returns {Run['steps']}
 */
function readSteps(evidenceDir) {
  const file = path.join(root, evidenceDir, 'steps.jsonl');
  if (!existsSync(file)) return {};
  /** @type {Run['steps']} */
  const steps = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const { step, exit, seconds } = JSON.parse(line);
    steps[step] = { exit, seconds };
  }
  return steps;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @param {string} [fallback]
 */
function flag(args, name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

/** @param {string[]} args */
function append(args) {
  // realpath on both sides: `root` is one, and a folder reached through a
  // symlinked parent (/var on macOS is /private/var) would otherwise be
  // recorded as a climb out of the repository.
  const given = path.resolve(flag(args, 'evidence'));
  const evidence = path.relative(root, existsSync(given) ? realpathSync(given) : given);
  const id = path.basename(evidence);
  if (!RUN_FILE.test(`${id}.json`)) {
    process.stderr.write(`verify-log: the evidence folder "${evidence}" is not named as a run id (<yyyymmdd>T<hhmmss>Z)\n`);
    process.exit(2);
  }
  const file = path.join(logDir(), `${id}.json`);
  if (existsSync(file)) {
    // Two runs cannot start in the same second from the same gate, so this is
    // a script being run twice for one folder, and the first record stands.
    process.stderr.write(`verify-log: run ${id} is already recorded; a recorded run is never rewritten\n`);
    process.exit(1);
  }
  // The verdict and the tree come from the receipt rather than from arguments,
  // so the durable record and the thing the commit gate reads cannot disagree
  // -- including when the receipt downgraded the run to `stale`.
  const receipt = readReceipt();
  /** @type {Run} */
  const entry = {
    at: new Date().toISOString(),
    result: receipt?.status ?? 'unknown',
    tree: receipt?.treeHash ?? null,
    // The commit this run was based on. The run's own result is not yet in any
    // commit, so this is a starting point, not an identity.
    head: (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    })(),
    branch: (() => {
      try {
        return (
          execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
          null
        );
      } catch {
        return null;
      }
    })(),
    node: process.version,
    evidence,
    steps: readSteps(evidence),
  };
  mkdirSync(logDir(), { recursive: true });
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  process.stdout.write(`${entry.result} ${entry.tree}\n`);
}

/** @param {string[]} args */
function check(args) {
  const base = flag(args, 'base', 'HEAD');
  // See check-feature-list.mjs: --at reads the record at a commit rather than
  // from the working tree, so CI can walk pushed commits one at a time.
  const at = flag(args, 'at');
  const current = at ? filesAt(at) : currentFiles();
  const baseline = filesAt(base);
  /** @type {string[]} */
  const problems = [];

  for (const [name, text] of baseline) {
    const now = current.get(name);
    if (now === undefined) problems.push(`run ${name} was removed. Recorded runs are never removed.`);
    else if (now !== text) problems.push(`run ${name} was rewritten. Recorded runs are not edited.`);
  }

  // Everything under the directory has to be a run: a stray file there is
  // either a record nothing wrote or a record renamed, and both are refused.
  const listing = at
    ? (() => {
        try {
          return execFileSync('git', ['ls-tree', '--name-only', `${at}:${LOG_DIR}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .split('\n')
            .filter(Boolean);
        } catch {
          return [];
        }
      })()
    : existsSync(logDir())
      ? readdirSync(logDir())
      : [];
  for (const name of listing) {
    if (!RUN_FILE.test(name)) problems.push(`${LOG_DIR}/${name} is not a run: a run's file is named after its evidence folder, <yyyymmdd>T<hhmmss>Z.json`);
  }

  for (const [name, text] of current) {
    /** @type {any} */
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      problems.push(`run ${name} is not valid JSON`);
      continue;
    }
    const missing = REQUIRED.filter((key) => entry[key] === undefined);
    if (missing.length) problems.push(`run ${name} is missing: ${missing.join(', ')}`);
    // The name is when the run started and `at` is when it was recorded, so
    // `at` before the name is a record claiming to predate its own run. This
    // is what is left of the old rule that lines may not be backdated: a
    // file cannot be dated against its neighbours, since branches record in
    // their own time, but it can be dated against itself.
    const recorded = Date.parse(String(entry.at));
    const match = RUN_FILE.exec(name);
    if (match && !Number.isNaN(recorded) && recorded < startedAt(match[1] ?? '').getTime()) {
      problems.push(`run ${name} is dated ${entry.at}, before it started`);
    }
  }

  const appended = [...current.keys()].filter((n) => !baseline.has(n)).length;
  console.log(`check-verify-log: ${current.size} run(s) recorded, baseline ${base}`);
  if (appended > 0) console.log(`  note: ${appended} run(s) recorded since ${base}`);

  // The audits are the second record, kept beside this one for the same
  // reasons and outside the hash for the same reason, so step 07 asks the
  // same questions of them; the commit gate asks them again on its own.
  for (const problem of auditProblems({ base, at })) problems.push(problem);
  console.log(`check-audit-log: ${(at ? auditsAt(at) : currentAudits()).size} audit(s) recorded under ${AUDIT_DIR}/, baseline ${base}`);

  if (problems.length) {
    console.error('check-verify-log: REJECTED');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-verify-log: ok');
}

/** @param {string[]} args */
function tail(args) {
  const n = Number(args[0] ?? 10);
  for (const e of readRuns().slice(-n)) {
    const failed = Object.entries(e.steps ?? {})
      .filter(([, s]) => s.exit !== 0)
      .map(([name]) => name);
    console.log(
      `${e.at}  ${e.result.toUpperCase().padEnd(4)}  ${(e.head ?? '').slice(0, 7)}  ` +
      `${failed.length ? failed.join(',') : 'all steps green'}`,
    );
  }
}

/**
 * Flakiness, from the record. A step that failed on some tree and passed on
 * that same tree — identical content, different verdicts — did not fail
 * because of the code. Failing runs are kept in the record precisely so this
 * can be counted; until 2026-09-08 nothing counted it.
 *
 * Returns one row per flaky step: how many trees it flaked on, how many times,
 * and when it last did. A tree with only failures is a real failure and is not
 * counted; a tree with only passes has nothing to say.
 * @param {Run[]} entries
 * @param {{ since?: string | null }} [options]
 */
export function flakes(entries, { since = null } = {}) {
  /** @type {Map<string, Run[]>} */
  const byTree = new Map();
  for (const e of entries) {
    if (!e.tree || (since && e.at < since)) continue;
    const runs = byTree.get(e.tree) ?? [];
    runs.push(e);
    byTree.set(e.tree, runs);
  }
  /** @type {Map<string, { step: string, trees: Set<string>, times: number, last: string }>} */
  const rows = new Map();
  for (const [tree, runs] of byTree) {
    if (!runs.some((r) => r.result === 'pass')) continue;
    for (const r of runs) {
      if (r.result === 'pass') continue;
      for (const [step, s] of Object.entries(r.steps ?? {})) {
        if (s.exit === 0) continue;
        const row = rows.get(step) ?? { step, trees: new Set(), times: 0, last: '' };
        row.trees.add(tree);
        row.times += 1;
        if (r.at > row.last) row.last = r.at;
        rows.set(step, row);
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({ step: r.step, trees: r.trees.size, times: r.times, last: r.last }))
    .sort((a, b) => b.times - a.times || a.step.localeCompare(b.step));
}

/** @param {string[]} args */
function report(args) {
  const days = Number(args[0] ?? 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const entries = readRuns();
  const rows = flakes(entries, { since });
  const window = entries.filter((e) => e.at >= since).length;
  console.log(`verify-log flakes: last ${days} day(s), ${window} run(s) on record`);
  if (rows.length === 0) {
    console.log('  no step has both failed and passed on the same tree');
    return;
  }
  console.log('  step            trees  times  last');
  for (const r of rows) {
    console.log(`  ${r.step.padEnd(16)}${String(r.trees).padStart(5)}  ${String(r.times).padStart(5)}  ${r.last}`);
  }
  console.log('  a step listed here failed on content that also passed: the code is not why');
}

/**
 * verify-log.jsonl, the record's shape before 2026-09-12, into files. Each
 * line becomes `verify-log/<evidence folder>.json`, byte-for-byte the same
 * fields; a file already there with the same record is left alone, one with
 * a different record stops the migration, and the old file is removed only
 * when every line has a file. A project on an earlier version runs this
 * once after taking the new scripts.
 */
function migrate() {
  const old = path.join(root, 'verify-log.jsonl');
  if (!existsSync(old)) {
    console.log('verify-log: no verify-log.jsonl to migrate');
    return;
  }
  const lines = readFileSync(old, 'utf8').split('\n').filter((l) => l.trim() !== '');
  mkdirSync(logDir(), { recursive: true });
  let written = 0;
  for (const [i, line] of lines.entries()) {
    /** @type {Run} */
    const entry = JSON.parse(line);
    const id = path.basename(String(entry.evidence ?? ''));
    if (!RUN_FILE.test(`${id}.json`)) {
      process.stderr.write(`verify-log: line ${i + 1} names no evidence folder to take a name from; not migrated\n`);
      process.exit(1);
    }
    const file = path.join(logDir(), `${id}.json`);
    const text = `${JSON.stringify(entry, null, 2)}\n`;
    if (existsSync(file)) {
      if (readFileSync(file, 'utf8') !== text) {
        process.stderr.write(`verify-log: ${LOG_DIR}/${id}.json exists and differs from line ${i + 1}; not migrated\n`);
        process.exit(1);
      }
      continue;
    }
    writeFileSync(file, text);
    written += 1;
  }
  rmSync(old);
  console.log(`verify-log: ${lines.length} run(s) in verify-log.jsonl, ${written} file(s) written, the file removed`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'append') return append(args);
  if (command === 'migrate') return migrate();
  if (command === 'check') return check(args);
  if (command === 'tail') return tail(args);
  if (command === 'flakes') return report(args);
  process.stderr.write('usage: verify-log.mjs append|check|tail|flakes [days]|migrate\n');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
