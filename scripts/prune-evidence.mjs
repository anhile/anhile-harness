#!/usr/bin/env node
// @ts-check
/**
 * Keeps .generated/runs/ from growing without bound.
 *
 * The per-run evidence folders are machine-local by design — absolute paths,
 * ANSI escapes, timings from one laptop — and what survives in git is
 * verify-log/, one file per run. So the folders are worth keeping only
 * while someone might still read them: the last few runs, and any run a failing
 * verdict points at. 208 folders and 155 MB accumulated before anyone looked.
 *
 * Keeps, in order of precedence:
 *   - the newest KEEP runs (default 10)
 *   - every run whose verify-log/ file recorded a non-pass verdict
 *
 * `--dry-run` prints what would go and deletes nothing.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRuns } from './verify-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(root, '.generated', 'runs');
const KEEP = Number(process.env.EVIDENCE_KEEP ?? 10);
const dryRun = process.argv.includes('--dry-run');

/** Evidence directories named in the log by any run that did not pass. */
function failedEvidence() {
  const keep = new Set();
  for (const entry of readRuns()) {
    if (entry.result !== 'pass' && entry.evidence) keep.add(path.basename(entry.evidence));
  }
  return keep;
}

/** @param {string} dir */
function directorySize(dir) {
  let total = 0;
  for (const item of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue;
    try {
      total += statSync(path.join(item.parentPath ?? item.path, item.name)).size;
    } catch {
      /* raced with a concurrent run; it is not this script's job to care */
    }
  }
  return total;
}

function main() {
  let runs;
  try {
    runs = readdirSync(RUNS).filter((name) => /^\d{8}T\d{6}Z$/.test(name)).sort();
  } catch {
    console.log('no .generated/runs — nothing to prune');
    return;
  }

  const keepFailed = failedEvidence();
  const keepNewest = new Set(runs.slice(-KEEP));
  const doomed = runs.filter((name) => !keepNewest.has(name) && !keepFailed.has(name));

  if (doomed.length === 0) {
    console.log(`${runs.length} run(s), none prunable (keeping newest ${KEEP} + failing runs)`);
    return;
  }

  let freed = 0;
  for (const name of doomed) {
    const dir = path.join(RUNS, name);
    freed += directorySize(dir);
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
  }

  const mb = (freed / 1024 / 1024).toFixed(1);
  const verb = dryRun ? 'would remove' : 'removed';
  console.log(
    `${verb} ${doomed.length} of ${runs.length} run(s), ${mb} MB — ` +
      `kept newest ${KEEP} and ${keepFailed.size} failing run(s)`,
  );
}

main();
