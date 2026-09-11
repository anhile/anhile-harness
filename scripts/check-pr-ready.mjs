#!/usr/bin/env node
/**
 * Is this branch ready to be a pull request?
 *
 * Every other gate in this repository answers a question about one commit or
 * one tree. This one answers a question about a *branch against main*, which
 * nothing else asks, and which has an answer that can be wrong in ways CI
 * discovers late and expensively.
 *
 * The check that could not have been written before 2026-09-11 is the merge
 * order. `verify-log.jsonl` is append-only and its timestamps must not
 * decrease, so two branches that both ran the gate produce a conflict whose
 * only resolution is to put the incoming lines at the end. That works when the
 * incoming lines are newer than everything on main, and is *unresolvable* when
 * they are not. Discovering that at merge time means a person staring at
 * conflict markers with no correct resolution available; discovering it here
 * costs one line of output. See docs/PARALLEL_WORK.md.
 *
 *   node scripts/check-pr-ready.mjs           # human output, exit 1 on refusal
 *   node scripts/check-pr-ready.mjs --json    # the same as data
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { treeHash, RECEIPT_FILE } from './verify-receipt.mjs';
import { describe, latestRun } from './check-main.mjs';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

/** The base branch every pull request in this repository targets. */
export const BASE = 'main';

/** Newest `at` in the log as of some revision, or null when it has no log. */
export function newestLogEntry(revision) {
  const raw = tryGit('show', `${revision}:verify-log.jsonl`);
  if (raw === null) return null;
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed.at === 'string') return parsed.at;
    } catch {
      /* a line that does not parse is the append-only guard's business */
    }
  }
  return null;
}

/**
 * Refusals, each one a sentence about what is wrong and what would fix it.
 * Exported so the suite can drive it without a repository in a given state.
 */
export function refusals({
  branch,
  dirty,
  receipt,
  headTree,
  baseNewest,
  branchNewest,
  aheadOfBase,
  progressTouched,
}) {
  const out = [];

  if (branch === BASE || branch === null) {
    out.push(
      `on ${branch ?? 'a detached HEAD'}: a pull request needs a branch of its own. ` +
        `Run \`git checkout -b <name>\` before the work, not after.`,
    );
  }

  if (dirty) {
    out.push(
      'the working tree has uncommitted changes. A pull request describes commits; ' +
        'commit them or stash them first.',
    );
  }

  if (aheadOfBase === 0) {
    out.push(`no commits ahead of ${BASE}. There is nothing to open a pull request about.`);
  }

  if (receipt === null) {
    out.push(
      'no verify receipt. Run `./verify.sh`: CI recomputes the tree hash from a clean ' +
        'clone and the attest job refuses a commit no recorded passing run covers.',
    );
  } else if (receipt.status !== 'pass') {
    out.push(`the last recorded run was ${receipt.status}, not pass. Fix it and run the gate again.`);
  } else if (headTree !== null && receipt.treeHash !== headTree) {
    out.push(
      'the tree changed after the last green run, so the receipt describes something ' +
        'other than what this branch would carry. Run `./verify.sh` again.',
    );
  }

  // The one that is not obvious, and the reason this file exists.
  if (baseNewest !== null && branchNewest !== null && branchNewest < baseNewest) {
    out.push(
      `this branch's newest gate run (${branchNewest}) is older than ${BASE}'s ` +
        `(${baseNewest}). verify-log.jsonl is append-only and its timestamps may not ` +
        `decrease, so merging this branch produces a conflict with no correct ` +
        `resolution. Run \`./verify.sh\` on this branch to append a newer line, then ` +
        `open the pull request. docs/PARALLEL_WORK.md explains why.`,
    );
  }

  if (progressTouched === false) {
    out.push(
      'no PROGRESS.md entry on this branch. The reviewer reads the journal before the ' +
        'diff, and session-stop.mjs will ask for one anyway.',
    );
  }

  return out;
}

function gather() {
  const branch = tryGit('branch', '--show-current') || null;
  const dirty = git('status', '--porcelain') !== '';

  let receipt = null;
  const receiptPath = path.join(root, RECEIPT_FILE);
  if (existsSync(receiptPath)) {
    try {
      receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    } catch {
      receipt = null;
    }
  }

  // origin/main when it is known, main otherwise: a clone that has never
  // fetched still deserves an answer rather than a crash.
  const base = tryGit('rev-parse', '--verify', `origin/${BASE}`) === null ? BASE : `origin/${BASE}`;
  const mergeBase = tryGit('merge-base', base, 'HEAD');
  const aheadOfBase = mergeBase === null ? 0 : Number(git('rev-list', '--count', `${mergeBase}..HEAD`));
  const progressTouched =
    mergeBase === null
      ? null
      : git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n').includes('PROGRESS.md');

  return {
    branch,
    dirty,
    receipt,
    headTree: treeHash(),
    baseNewest: newestLogEntry(base),
    branchNewest: newestLogEntry('HEAD'),
    aheadOfBase,
    progressTouched,
    base,
  };
}

function main() {
  const facts = gather();
  const found = refusals(facts);
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify({ ok: found.length === 0, refusals: found, facts }, null, 2));
    process.exit(found.length === 0 ? 0 : 1);
  }

  console.log(`check-pr-ready: ${facts.branch ?? 'detached'} against ${facts.base}, ` +
    `${facts.aheadOfBase} commit(s) ahead`);

  // Said here and not refused on. A red main is often exactly why somebody is
  // opening a pull request, and a guard that blocks the fix for the thing it
  // complains about is a guard that gets removed. But four pull requests were
  // opened on a red main on 2026-09-11 without anybody noticing, and this is
  // the last place a person looks before opening another.
  const main = describe(latestRun());
  if (main.line !== null && !main.ok) console.log(`\n${main.line}\n`);

  if (found.length === 0) {
    console.log('check-pr-ready: ok');
    process.exit(0);
  }

  console.error('check-pr-ready: NOT READY');
  for (const line of found) console.error(`  - ${line}`);
  process.exit(1);
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
