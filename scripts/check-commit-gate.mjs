#!/usr/bin/env node
// @ts-check
/**
 * The commit gate. A Claude Code `PreToolUse` hook.
 *
 * Two jobs:
 *
 *   1. Refuse a `git commit` unless `./verify.sh` last PASSED, against the
 *      exact tree that is about to be committed.
 *   2. Refuse edits to the gate's own machinery, so removing it is a visible
 *      act rather than a silent one.
 *
 * Why it exists: this repository already carries two commits made on a red
 * `verify.sh`. Both times the gate had been run and its verdict read; what was
 * missing was any link between reading the verdict and being allowed to commit.
 * A rule that depends on the session remembering it is not a rule, it is a
 * preference. See docs/INVARIANTS.md I11.
 *
 * It binds the agent, not the human. Claude Code hooks fire on the agent's tool
 * calls; a person committing in their own terminal is untouched. That asymmetry
 * is the design: when the gate is wrong, the human overrules it, and the agent
 * cannot overrule it on its own initiative.
 *
 * Protocol: hook JSON on stdin; exit 0 to allow, exit 2 to block with the
 * reason on stderr.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_FILE, changedPaths, hashFiles, isQuick, readReceipt, root, treeFiles } from './verify-receipt.mjs';
import { currentBranch, isSpike } from './spike.mjs';
// PROTECTED lives with the content check, so the two can never disagree
// about what they are protecting.
import { PROTECTED, driftFromBaseline } from './check-protected-files.mjs';
// A closing commit -- one whose index flips an entry's passes to true -- also
// needs the spec-auditor's verdict about this same tree. The receipt and the
// rules for reading it live with the script /verify-task writes it through.
import { AUDIT_FILE, auditProblems, closingEntries } from './audit-receipt.mjs';


/** Global git flags that swallow the next token, so it is not the subcommand. */
const GIT_FLAGS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);

/**
 * What Claude Code hands the PreToolUse hook on stdin; only the fields read here.
 * @typedef {{ tool_name?: string, tool_input?: { command?: unknown, file_path?: string, notebook_path?: string } }} HookPayload
 */

/**
 * @param {string} message
 * @returns {never}
 */
function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** Split a shell command into segments that each start a fresh command. */
/** @param {string} command */
function segments(command) {
  return command.split(/\n|;|&&|\|\||\||&/g);
}

/** Does this segment invoke `git <subcommand>`? Returns the subcommand or null. */
/** @param {string} segment */
function gitSubcommand(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  // Leading environment assignments: `GIT_AUTHOR_NAME=x git commit`.
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] ?? '')) i += 1;
  if (tokens[i] !== 'git') return null;
  i += 1;
  while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
    if (GIT_FLAGS_WITH_ARG.has(tokens[i] ?? '')) i += 1;
    i += 1;
  }
  return tokens[i] ?? null;
}

/** @param {string} command */
function createsACommit(command) {
  return segments(command).some((segment) => gitSubcommand(segment) === 'commit');
}

/** Does the commit stage tracked modifications itself? `git commit -a`. */
/** @param {string} command */
function stagesEverythingTracked(command) {
  return segments(command).some((segment) => {
    if (gitSubcommand(segment) !== 'commit') return false;
    return segment
      .trim()
      .split(/\s+/)
      .some((token) => token === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(token));
  });
}

/**
 * What the commit would contain, against what was verified.
 *
 * The tree hash covers the index plus untracked-but-not-ignored files, because
 * that set is what stays stable across `git add`. The cost is that a green
 * receipt can describe a tree no commit reproduces: an untracked file counts
 * toward the hash and then is not committed, and a partial `git add` commits
 * the index while the receipt described the working tree.
 *
 * The untracked case is the one the hash cannot see at all: an untracked file is
 * in the hashed set both before and after, so the receipt matches perfectly while
 * the commit leaves the file out. That is how commit 925eb56 was made against a
 * receipt covering an untracked README.md, and why CI's attestation — which
 * recomputes the hash from a clean clone — refused it. Unstaged modifications
 * usually move the hash too; this catches them with a clearer message.
 */
/** @param {string} command */
function indexMatchesWorkingTree(command) {
  const status = execFileSync('git', ['status', '--porcelain=v1'], {
    cwd: root,
    encoding: 'utf8',
  });

  /** @type {string[]} */
  const untracked = [];
  /** @type {string[]} */
  const unstaged = [];
  for (const line of status.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === '??') untracked.push(file);
    // Second column is the working-tree status; a non-space means the file
    // differs from what is staged.
    else if (code[1] !== ' ') unstaged.push(file);
  }

  return { untracked, unstaged: stagesEverythingTracked(command) ? [] : unstaged };
}

/**
 * Does this shell command write to `target`? Deliberately narrow: the path
 * appearing as a redirect destination, or as an argument to a command that
 * modifies files. `grep foo verify.sh` reads and is left alone.
 */
/**
 * @param {string} command
 * @param {string} target
 */
function shellWritesTo(command, target) {
  const quoted = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const asPath = `\\.?/?${quoted}`;
  if (new RegExp(`>>?\\s*['"]?${asPath}`).test(command)) return true;
  if (new RegExp(`\\b(sed\\s+-i|tee|rm|mv|cp|truncate|chmod|ln|install)\\b[^\\n;&|]*${asPath}`).test(command)) return true;
  return false;
}

/**
 * `root` is a realpath, so the target must be one too or a symlinked ancestor
 * (/var -> /private/var on macOS) makes every comparison miss. The file itself
 * may not exist yet, so this resolves the deepest ancestor that does and
 * re-appends the rest.
 */
/** @param {string} target */
function realpathDeepest(target) {
  /** @type {string[]} */
  const parts = [];
  let current = target;
  for (;;) {
    try {
      return path.join(realpathSync(current), ...parts);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      parts.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** @param {string | undefined} filePath */
function relativeToRoot(filePath) {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  return path.relative(root, realpathDeepest(abs));
}

/**
 * @param {string} target
 * @param {string} how
 */
function protectionMessage(target, how) {
  return `BLOCKED: commit gate (docs/INVARIANTS.md I11) — ${how} ${target}

${target} is part of the gate that decides whether this session may commit.
A session does not get to edit the rule it is measured against; that is the same
failure the feature_list.json guard exists to stop, one level up.

If this file genuinely needs to change, that is a human decision. Say what you
want to change and why, and let them make the edit or lift the hook in
.claude/settings.json.`;
}

/** @param {HookPayload} payload */
function checkProtectedPaths(payload) {
  const toolName = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};

  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(toolName)) {
    const rel = relativeToRoot(input.file_path ?? input.notebook_path);
    if (rel && PROTECTED.includes(rel)) block(protectionMessage(rel, `${toolName} targets`));
  }

  if (toolName === 'Bash' && typeof input.command === 'string') {
    for (const target of PROTECTED) {
      if (shellWritesTo(input.command, target)) block(protectionMessage(target, 'this command writes to'));
    }
  }
}

/**
 * The half that does not guess. `shellWritesTo` above reads the command and
 * decides whether it looks like a write; it missed every interpreter, because
 * enumerating them is a losing game. This reads the files.
 *
 * Recomputed here rather than read from the tripwire that
 * check-protected-files.mjs drops, so deleting the tripwire changes nothing,
 * and deleting the baseline makes this stricter: the fallback is HEAD.
 *
 * It stays silent when a person edited a protected file between two messages,
 * because their next message re-baselines it. That asymmetry is the point --
 * the gate binds the session, not the human.
 */
/** @param {HookPayload} payload */
function checkProtectedContent(payload) {
  if ((payload.tool_name ?? '') !== 'Bash') return;
  const command = (payload.tool_input ?? {}).command;
  if (typeof command !== 'string' || !createsACommit(command)) return;

  const drifted = driftFromBaseline();
  if (drifted.length === 0) return;

  block(`BLOCKED: commit gate (docs/INVARIANTS.md I11) -- a protected file changed in this session

${drifted.join('\n')}

The commit would carry an edit to the gate that decides whether this session may
commit. Whether the edit is an improvement is not the question; that a session
made it unreviewed is.

Put the file back, or say what you want changed and let the person make the edit
or lift the hook in .claude/settings.json. Their next message re-baselines these
files, so an edit they make themselves does not trip this.`);
}

/**
 * The receipt, or a refusal: none, stale, or red. Split out so a spike (I16)
 * can skip the asking without skipping anything else in checkCommit.
 * @returns {NonNullable<ReturnType<typeof readReceipt>>}
 */
function checkedReceipt() {
  const receipt = readReceipt();


  if (!receipt) {
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I11)

No verify receipt at ${RECEIPT_FILE}. Nothing has checked this working tree, so
nothing may be committed from it.

  ./verify.sh

Then commit. If verify.sh cannot run here at all, the commit is a human
decision — ask for it rather than working around the gate.`);
  }

  if (receipt.status === 'stale') {
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I11)

The working tree changed *while* the last ./verify.sh run was in flight, so its
steps did not all see the same code and its verdict describes no single tree.

  run:      ${receipt.finishedAt}
  evidence: ${receipt.evidence}

Run ./verify.sh again, and leave the tree alone until it finishes.`);
  }

  if (receipt.status !== 'pass') {
    const failed = receipt.failedSteps?.length ? receipt.failedSteps.join(', ') : 'unknown';
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I11)

The last ./verify.sh run FAILED.

  failed:   ${failed}
  run:      ${receipt.finishedAt}
  evidence: ${receipt.evidence}

Fix the failing step(s) and run ./verify.sh again. Committing on red is not a
hypothetical here: this repository already carries two commits made this way,
and that is the failure this gate exists to stop. Splitting the change into a
smaller commit does not help — the gate is about the tree, not the diff.`);
  }

  return receipt;
}

/** @param {HookPayload} payload */
function checkCommit(payload) {
  if ((payload.tool_name ?? '') !== 'Bash') return;
  const command = (payload.tool_input ?? {}).command;
  if (typeof command !== 'string' || !createsACommit(command)) return;

  // A spike branch proves nothing and cannot reach main (I16). It is asked
  // for no receipt, and nothing the receipt would establish is checked below:
  // the tree hash, the closing audit, the index against the tree. The
  // protected-file checks above ran as on any branch, and the two append-only
  // guards next run as on any branch: a spike claims nothing, and rewrites
  // nothing.
  const branch = currentBranch();
  const spike = isSpike(branch);
  if (spike) process.stderr.write(`commit gate: ${branch} is a spike, no receipt asked (docs/INVARIANTS.md I16)\n`);
  const receipt = spike ? null : checkedReceipt();

  // audit-log/ is outside the tree hash for the same reason verify-log/ is
  // (below), and gets the same treatment: its own guard, here, before the
  // hash is trusted. First, because verify-log's guard asks the audits too
  // as step 07 and would otherwise name an edited audit under the wrong
  // heading.
  try {
    execFileSync('node', [path.join(root, 'scripts', 'audit-log.mjs'), 'check'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    const detail = String(/** @type {{ stderr?: unknown }} */ (error ?? {}).stderr ?? '').trim();
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I15)

audit-log/ has been rewritten, not appended to: a recorded audit was edited or
removed. The record of what the auditor concluded is not a thing a session edits.

${detail}

Restore it with: git checkout -- audit-log/`);
  }

  // verify-log/ is deliberately outside the tree hash -- verify.sh records
  // to it at the end of every run, so hashing it would make each run invalidate
  // its own receipt. That leaves a window the hash cannot see, so the gate runs
  // the log's own guard here rather than trusting the hash to cover it.
  try {
    execFileSync('node', [path.join(root, 'scripts', 'verify-log.mjs'), 'check'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    const detail = String(/** @type {{ stderr?: unknown }} */ (error ?? {}).stderr ?? '').trim();
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I12)

verify-log/ has been rewritten, not appended to: a recorded run was edited or
removed. The record of what has
been verified is not a thing a session edits.

${detail}

Restore it with: git checkout -- verify-log/`);
  }


  // A spike ends here: what follows is what the receipt establishes, and a
  // spike has none (I16).
  if (!receipt) return;

  // A quick run establishes less, and says so here: the commit gate takes
  // it for a commit that closes nothing, and the full gate is CI's on
  // that commit. A closure is refused on it below.
  if (isQuick(receipt)) {
    process.stderr.write(
      `commit gate: the receipt is from ./verify.sh --quick (since ${receipt.quickBase ?? 'main'}): ` +
        'lint, types and the affected suites; the full gate is CI\'s on this commit (docs/INVARIANTS.md I11)\n',
    );
  }

  // PROGRESS.md is outside the tree hash since 2026-09-16, so that the entry
  // naming a closure's audit can share the closure's commit. What the hash no
  // longer covers, the journal's own check covers here: every entry new since
  // HEAD in the template's shape, its Evidence pointing into the record (I12).
  try {
    execFileSync('node', [path.join(root, 'scripts', 'progress.mjs'), 'check', '--base', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    const detail = String(/** @type {{ stderr?: unknown }} */ (error ?? {}).stderr ?? '').trim();
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I12) — the journal is asked before the commit

${detail}

PROGRESS.md is outside the tree hash so that an entry can name the audit its
own commit carries; in exchange the gate reads it here, the way CI's walk will.
Fix the entry and commit again: a journal edit needs no new run.`);
  }

  const current = treeFiles();
  const currentHash = hashFiles(current);
  if (currentHash !== receipt.treeHash) {
    const changed = changedPaths(receipt.files, current);
    const shown = changed.slice(0, 20).map((p) => `    ${p}`).join('\n');
    const more = changed.length > 20 ? `\n    … and ${changed.length - 20} more` : '';
    block(`BLOCKED: commit gate (docs/INVARIANTS.md I11)

./verify.sh passed, but not against this tree. ${changed.length} path(s) have
changed since that run, so its PASS says nothing about what you are committing.

  verified: ${receipt.treeHash}
  current:  ${currentHash}
  run:      ${receipt.finishedAt}

changed:
${shown}${more}

Run ./verify.sh again.`);
  }

  // Closing an entry claims the work is done. verify.sh says the tests that
  // exist passed; only the auditor says whether the contract's criteria have
  // evidence. Ninety entries were closed before either reviewer ever ran, and
  // a rule that depends on someone remembering to type /verify-task is a
  // preference. So: no closing commit without the audit receipt, about this
  // tree, of this contract, saying READY.
  const closing = closingEntries();
  if (closing.length > 0) {
    const which = closing.map((e) => `#${e.id} — ${e.description}`).join('\n  ');
    const spec = closing.find((e) => e.spec)?.spec ?? '<the contract>';

    // A closure claims the work is done, and the audit that backs the claim
    // is about the full gate: a quick run left three steps to CI and ran
    // only the suites it found affected, so its evidence folder is not what
    // the auditor is handed. Before the audit is asked, because the audit
    // writer refuses a quick receipt too and would say the same thing.
    if (isQuick(receipt)) {
      block(`BLOCKED: commit gate (docs/INVARIANTS.md I11) — a closure is asked for the full gate

This commit flips to passing:
  ${which}

The receipt is from ./verify.sh --quick (since ${receipt.quickBase ?? 'main'}): lint, types and the
suites affected since then, with api-e2e, browser-e2e and coverage left out.
That is enough for a commit that claims nothing. A closure claims the work is
done, and the audit it needs is about the full gate.

  ./verify.sh
  /verify-task ${spec}`);
    }

    const problems = auditProblems(receipt.treeHash, closing);
    if (problems.length > 0) {
      block(`BLOCKED: commit gate (docs/INVARIANTS.md I15) — a closing commit needs the audit

This commit flips to passing:
  ${which}

${problems.map((p) => `  - ${p}`).join('\n')}

Run the audit on this tree, then commit:

  /verify-task ${spec}

It runs ./verify.sh, hands the diff and the contract to the spec-auditor, runs
security-check where the surface moved, and writes ${AUDIT_FILE}. Only a READY
verdict lets a closing commit through; NOT READY is a result to act on, not a
gate to get past.`);
    }
  }

  const { untracked, unstaged } = indexMatchesWorkingTree(command);
  if (untracked.length > 0 || unstaged.length > 0) {
    /** @param {string[]} paths */
    const list = (paths) => paths.slice(0, 15).map((p) => `    ${p}`).join('\n') +
      (paths.length > 15 ? `\n    … and ${paths.length - 15} more` : '');
    /** @type {string[]} */
    const parts = [];
    if (untracked.length) parts.push(`not tracked, so not in the commit:\n${list(untracked)}`);
    if (unstaged.length) parts.push(`changed since they were staged:\n${list(unstaged)}`);

    block(`BLOCKED: commit gate (docs/INVARIANTS.md I11)

The commit would not contain the tree that was verified.

${parts.join('\n\n')}

./verify.sh measured the working tree; this commit would carry something else,
and CI recomputes the hash from a clean clone and will say so. Stage everything
with \`git add -A\`, or put what does not belong in .gitignore.`);
  }
}

function main() {
  /** @type {HookPayload} */
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    // A hook that cannot read its input must not be the reason work stops.
    // It fails open here and only here; every decision below fails closed.
    process.exit(0);
  }
  checkProtectedPaths(payload);
  checkProtectedContent(payload);
  checkCommit(payload);
  process.exit(0);
}

// See the note in verify-receipt.mjs: this comparison must go through realpath,
// or the hook loads, defines everything, and decides nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}

export { createsACommit, gitSubcommand, shellWritesTo, PROTECTED };
