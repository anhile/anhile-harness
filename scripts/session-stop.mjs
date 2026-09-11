#!/usr/bin/env node
/**
 * "End every session with an entry in PROGRESS.md", enforced. A Claude Code
 * `Stop` hook: exit 2 keeps the session going with this script's stderr as the
 * next thing it reads; exit 0 lets it stop.
 *
 * The rule it checks is narrow on purpose. It does not ask whether the working
 * tree changed — a turn that ends mid-task, waiting for a person to apply a
 * patch, is a fine place to stop. It asks whether *commits landed* since the
 * session began without any of them touching PROGRESS.md. That is the
 * definition-of-done item that a session forgets, and it is checkable from
 * git alone: the PROGRESS.md blob at HEAD against the blob at the session's
 * starting HEAD.
 *
 * It reminds once. `stop_hook_active` is Claude Code saying the session is
 * already continuing because of a stop hook, and the session record carries a
 * `reminded` flag for the same reason: a hook that blocks every stop until it
 * is satisfied is a hook that gets deleted.
 *
 * A second, separate reminder, also once: local `main` ahead of `origin/main`.
 * CLAUDE.md's push rule exists because a week of commits once stayed on one
 * laptop while every document described CI as live. No origin, no reminder.
 *
 * No record from session-start.mjs means nothing to compare against, and a
 * check with nothing to compare against says nothing rather than guessing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestEntry, root, sessionFile } from './session-start.mjs';
import { template } from './progress.mjs';

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** The blob id of PROGRESS.md at a commit, or '' when it is absent. */
function progressBlobAt(commit) {
  return git('rev-parse', `${commit}:PROGRESS.md`);
}


/** Commits on the current branch that origin/main does not have, or null without an origin. */
export function unpushed() {
  if (git('rev-parse', '--verify', '--quiet', 'origin/main') === '') return null;
  const count = Number(git('rev-list', '--count', 'origin/main..HEAD') || '0');
  return Number.isFinite(count) ? count : null;
}

/**
 * Is this branch's head already somewhere CI looks?
 *
 * The rule this hook enforces is not "the commit is on main". It is "the
 * commit is not invisible to CI", and until 2026-09-11 those were the same
 * sentence because every commit went straight to main. The first pull request
 * this repository ever opened was stopped by this hook for being on a branch,
 * which is the thing the pull request existed to make possible.
 *
 * The workflow triggers on a push to main and on a pull request. A branch that
 * is merely pushed triggers nothing, so "pushed" alone is not enough; there
 * has to be a pull request carrying it. When `gh` cannot answer — not
 * installed, not authenticated, no network — this says so rather than
 * guessing, and the caller stays quiet, which is the same rule the rest of
 * this file follows about checks that cannot see.
 */
export function prForHead() {
  const branch = git('branch', '--show-current');
  // On main, or on a detached HEAD, there is nothing to determine: the caller
  // only asks after finding commits origin/main does not have, and on main
  // that *is* the answer. Returning "cannot tell" here made the hook go quiet
  // in the one case it has always been right about.
  if (branch === '' || branch === 'main') return { known: true, open: false, pushed: false, branch };

  const head = git('rev-parse', 'HEAD');
  const remoteHead = git('rev-parse', '--verify', '--quiet', `origin/${branch}`);
  if (remoteHead === '' || remoteHead !== head) {
    // Nothing pushed, or pushed and then committed over. Either way CI has not
    // seen this head, and that is knowable without asking GitHub anything.
    return { known: true, open: false, pushed: false, branch };
  }

  let raw = '';
  try {
    raw = execFileSync('gh', ['pr', 'view', branch, '--json', 'state,number'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    return { known: false, open: false, pushed: true, branch };
  }

  try {
    const parsed = JSON.parse(raw);
    return { known: true, open: parsed.state === 'OPEN', number: parsed.number, pushed: true, branch };
  } catch {
    return { known: false, open: false, pushed: true, branch };
  }
}

export function verdict(payload, record) {
  if (payload.stop_hook_active) return { block: false, reason: 'already continuing from a stop hook' };
  if (!record || !record.head) return { block: false, reason: 'no session record' };
  const head = git('rev-parse', 'HEAD');
  if (!head || head === record.head) return { block: false, reason: 'no commits since the session began' };
  // Two reminders, each once, the journal first: an entry that is not yet
  // written is not yet pushed either.
  if (!record.reminded) {
    const progress = progressVerdict(record, head);
    if (progress.block) return { ...progress, kind: 'progress' };
  }
  if (!record.remindedPush) {
    const ahead = unpushed();
    if (ahead !== null && ahead > 0) {
      const pr = prForHead();
      // A branch whose head is carried by an open pull request has been seen by
      // CI, which is the whole of what this reminder is about. Anything this
      // cannot determine counts as seen: a hook that blocks on what it cannot
      // check is a hook that gets deleted.
      if (!pr.known || pr.open) {
        return { block: false, reason: pr.open ? `carried by pull request #${pr.number}` : 'cannot tell whether a pull request carries this' };
      }
      const detail = pr.pushed
        ? `pushed to origin/${pr.branch}, but no open pull request carries it, so CI has run nothing on it`
        : `${ahead} commit(s) on this branch are not on origin/main`;
      return { block: true, kind: 'push', reason: detail, pushed: pr.pushed === true };
    }
  }
  return { block: false, reason: record.reminded ? 'reminded once already' : 'nothing to remind about' };
}

function progressVerdict(record, head) {
  // The session's starting commit may be gone — a rebase, a reset. Nothing to
  // compare against, so say nothing.
  if (git('rev-parse', '--verify', '--quiet', `${record.head}^{commit}`) === '') {
    return { block: false, reason: 'the starting commit is no longer reachable' };
  }
  const before = progressBlobAt(record.head);
  const after = progressBlobAt(head);
  if (before !== after) return { block: false, reason: 'PROGRESS.md changed in a commit this session' };
  const count = git('rev-list', '--count', `${record.head}..${head}`) || '?';
  return {
    block: true,
    reason: `${count} commit(s) landed since ${record.head.slice(0, 7)} and none touched PROGRESS.md`,
  };
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  if (payload.hook_event_name && payload.hook_event_name !== 'Stop') process.exit(0);

  const file = sessionFile(payload.session_id);
  const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const result = verdict(payload, record);
  if (!result.block) process.exit(0);

  const flag = result.kind === 'push' ? { remindedPush: true } : { reminded: true };
  try {
    writeFileSync(file, `${JSON.stringify({ ...record, ...flag, remindedAt: new Date().toISOString() })}\n`);
  } catch {
    /* if the flag cannot be written, the session is reminded once per stop instead */
  }

  if (result.kind === 'push') {
    // Two shapes of the same rule: a commit must not be invisible to CI. What
    // fixes it differs, and the old text said `git push` to a branch that was
    // already pushed — which is how the repository's first pull request got
    // stopped by the hook meant to protect it.
    const remedy = result.pushed
      ? '  /open-pr\n\n' +
        'The workflow runs on a push to main and on a pull request. A branch that is\n' +
        'only pushed triggers neither, so the commits are on GitHub and no gate has\n' +
        'looked at them.\n\n'
      : '  git push\n\n' +
        'The pre-push hook attests each commit first.\n\n';

    process.stderr.write(
      `STOP: ${result.reason}.\n\n` +
        'CLAUDE.md: push after every commit that closes an entry, and before the session\n' +
        'ends. A commit no gate has seen is a claim nothing has checked.\n\n' +
        remedy +
        'If this is deliberate — a person asked for it, or the pull request is being held\n' +
        'open — say so and stop; this reminder does not fire again in this session.\n',
    );
    process.exit(2);
  }

  const progress = existsSync(path.join(root, 'PROGRESS.md')) ? readFileSync(path.join(root, 'PROGRESS.md'), 'utf8') : '';
  const newest = newestEntry(progress);
  process.stderr.write(
    `STOP: ${result.reason}.\n\n` +
      'CLAUDE.md: end every session with an entry in PROGRESS.md, newest at the bottom.\n' +
      `The newest entry is ${newest ? `${newest.date} — ${newest.title}` : '(none)'}.\n\n` +
      'Before stopping: append an entry in this shape, run ./verify.sh, and commit it.\n' +
      'If the commits were not yours — a person committed from their terminal — say so\n' +
      'and stop; this reminder does not fire again in this session.\n\n' +
      `${template()}\n`,
  );
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
