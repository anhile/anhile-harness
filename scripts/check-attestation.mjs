#!/usr/bin/env node
/**
 * Does this commit carry a passing verify run of its own content?
 *
 * verify-log.jsonl records, for each run, the hash of the tree it ran against.
 * That hash is computed over the tracked files, so it can be **recomputed from
 * a pristine clone** — which is the whole point. Locally the record is a
 * session's report about itself. Recomputed somewhere else, by something that
 * did not write it, it becomes a claim that can be checked and can fail.
 *
 * This is what turns "verify.sh 6/6" from an assertion into evidence. It does
 * not verify the code -- CI runs ./verify.sh separately for that. It verifies
 * the *claim*: that the run being pointed at was about this exact content.
 *
 * Run it in CI on a bare checkout, before installing anything.
 *
 *   node scripts/check-attestation.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { treeHash } from './verify-receipt.mjs';
import { LOG_FILE, readLines, root } from './verify-log.mjs';

function fail(lines) {
  console.error(`check-attestation: REJECTED\n${lines.join('\n')}`);
  process.exit(1);
}

function main() {
  const tree = treeHash();
  const file = path.join(root, LOG_FILE);

  if (!existsSync(file)) {
    fail([`  - ${LOG_FILE} is missing. Nothing records what has been verified.`]);
  }

  const runs = readLines(readFileSync(file, 'utf8')).map((line) => JSON.parse(line));
  const matching = runs.filter((run) => run.tree === tree);

  console.log(`check-attestation: tree ${tree}`);
  console.log(`  ${runs.length} run(s) on record, ${matching.length} against this tree`);

  if (matching.length === 0) {
    fail([
      `  - No recorded ./verify.sh run was against this tree.`,
      '',
      '    Either this commit was made without running the gate, or its content',
      '    changed after the last run. Both are the same problem: nothing here',
      '    claims to have checked what is actually committed.',
      '',
      `    Most recent run on record was against: ${runs[runs.length - 1]?.tree ?? '(none)'}`,
    ]);
  }

  // The last word on this exact content. Earlier attempts against the same tree
  // are history, not the verdict -- but they are worth surfacing, because the
  // same content passing and failing is the definition of a flaky step.
  const verdict = matching[matching.length - 1];
  const failedRuns = matching.filter((run) => run.result !== 'pass');

  if (verdict.result !== 'pass') {
    const failedSteps = Object.entries(verdict.steps ?? {})
      .filter(([, step]) => step.exit !== 0)
      .map(([name]) => name);
    fail([
      `  - The last recorded run against this tree was "${verdict.result}".`,
      `    at:     ${verdict.at}`,
      `    failed: ${failedSteps.join(', ') || '(not recorded)'}`,
    ]);
  }

  console.log(`  verdict: pass, recorded ${verdict.at} on ${(verdict.head ?? '').slice(0, 7)}`);

  if (failedRuns.length > 0) {
    // Not a failure: the tree does pass. But identical content that has both
    // failed and passed is the only cheap signal this project has for flakiness,
    // and it is invisible unless something says it out loud.
    console.log(
      `  note: this same content also failed ${failedRuns.length} time(s) — ` +
      `${failedRuns.map((run) => run.at).join(', ')}`,
    );
    console.log('        identical content with different verdicts means a flaky step.');
  }

  console.log('check-attestation: ok');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
