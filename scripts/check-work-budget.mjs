#!/usr/bin/env node
// @ts-check
/**
 * A budget on how far a session may run without checking in.
 *
 * Written after a request to "write a README" turned into several hours of
 * harness work and consumed a quota. Some of that work was approved along the
 * way; the pattern was not. Going deep without asking is cheap for the agent
 * and expensive for the person paying for it, and no amount of good intent
 * fixes something that costs nothing to get wrong.
 *
 * Two events:
 *   UserPromptSubmit — the person said something, so the budget resets.
 *   PreToolUse       — one more step spent; over the limit, stop and report.
 *
 * What counts as a step. Every Edit, Write and NotebookEdit does. A Bash call
 * counts unless every command in it is one of the read-only verbs below — a
 * session that reads forty files to answer a question has spent the person's
 * attention on nothing, and until 2026-09-08 that session was stopped at thirty
 * before it had written a line. The budget is on doing, not on looking.
 *
 * The block is not a failure. It says: summarise what is done, say what is
 * left, and let the person decide whether to keep paying for it. Answering
 * resets the budget, so continuing costs one sentence.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { loadConfig } from './harness-config.mjs';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
// Under .generated/, which every project ignores. This lived under .claude/
// until 2026-09-12, untracked and unignored, and the tree hash counts such
// files: every tool call rewrote it, every gate run after one went stale, and
// the commit gate refused. Found in this repository, fixed for it, and only
// then noticed in the .gitignore the generator writes.
const FILE = path.join(root, '.generated', 'work-budget.json');

/**
 * Tool calls between one message from the person and the next. The
 * environment wins, then `session.workBudget` in harness.config.json, then
 * thirty. Read leniently: a hook that throws on a malformed configuration
 * would stop every tool call, which is a worse outcome than a default.
 */
function limit() {
  if (process.env.WORK_BUDGET_LIMIT !== undefined) return Number(process.env.WORK_BUDGET_LIMIT);
  try {
    return loadConfig().session?.workBudget ?? 30;
  } catch {
    return 30;
  }
}
const LIMIT = limit();

/**
 * Commands that only look. A Bash call whose every segment starts with one of
 * these does not spend the budget. Anything else — including a verb not listed,
 * because the list is an allowlist — does.
 */
const READ_ONLY = [
  /^(cat|head|tail|less|wc|ls|find|tree|stat|file|du|df|pwd|echo|printf|date|which|type)\b/u,
  /^(grep|rg|ag|diff|cut|sort|uniq|tr|awk|jq|yq)\b/u,
  /^sed\s+-n\b/u,
  /^git\s+(status|diff|log|show|rev-parse|rev-list|branch(\s+(-a|-r|-v|--show-current|--list))?|remote(\s+-v)?|worktree\s+list|blame|describe|ls-files|check-ignore|merge-base|cat-file|tag(\s+-l)?)\b/u,
  /^gh\s+(run\s+(list|view|watch)|pr\s+(list|view|checks)|api\b|repo\s+view)/u,
  /^node\s+scripts\/(verify-log\.mjs\s+(tail|flakes)|check-attestation\.mjs|migrate\.mjs\s+--status)\b/u,
  /^(cd|export|set|true|:)\b/u,
];

/**
 * What Claude Code hands a hook on stdin; only the fields read here.
 * @typedef {{ hook_event_name?: string, tool_name?: string, tool_input?: { command?: unknown } }} HookPayload
 */

/**
 * Split a shell command into the commands it runs, dropping empty segments.
 * @param {string} command
 */
function segments(command) {
  return command
    .split(/\n|;|&&|\|\||\|/gu)
    .map((s) => s.trim().replace(/^\(+|\)+$/gu, '').trim())
    .filter(Boolean);
}

/**
 * Does this tool call spend the budget?
 * @param {string | undefined} toolName
 * @param {{ command?: unknown }} [toolInput]
 */
export function spends(toolName, toolInput = {}) {
  if (toolName !== 'Bash') return true;
  const command = String(toolInput.command ?? '');
  // A redirect writes, whatever the verb in front of it. `2>&1` and `>/dev/null`
  // are the two harmless forms and are stripped before the check.
  const withoutHarmless = command.replace(/2>&1|>\s*\/dev\/null/gu, '');
  if (/>/u.test(withoutHarmless)) return true;
  const parts = segments(command);
  if (parts.length === 0) return true;
  return !parts.every((part) => READ_ONLY.some((re) => re.test(part)));
}

/** @returns {{ count?: number, since?: string }} */
function read() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { count: 0 };
  }
}

/** @param {{ count: number, since?: string }} state */
function write(state) {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, `${JSON.stringify(state)}\n`);
  } catch {
    /* a budget that cannot be written must not stop work */
  }
}

function main() {
  /** @type {HookPayload} */
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }

  const event = payload.hook_event_name ?? '';

  if (event === 'UserPromptSubmit') {
    write({ count: 0, since: new Date().toISOString() });
    process.exit(0);
  }

  if (event !== 'PreToolUse') process.exit(0);
  if (!spends(payload.tool_name, payload.tool_input)) process.exit(0);

  const state = read();
  const count = (state.count ?? 0) + 1;
  write({ ...state, count });

  if (count <= LIMIT) process.exit(0);

  process.stderr.write(
    `STOP: ${count} tool calls since the last message from the person, limit ${LIMIT}.\n\n` +
      'This is not an error and nothing is wrong with the work. It is the point at\n' +
      'which running further without asking stops being your call.\n\n' +
      'Do this now:\n' +
      '  1. Stop. Do not finish "just this one thing" first.\n' +
      '  2. Say what is done, in a few lines.\n' +
      '  3. Say what is left and roughly what it will cost.\n' +
      '  4. Ask whether to continue.\n\n' +
      'Their next message resets the budget, so continuing costs one sentence.\n' +
      'If the work genuinely needs a longer run, say so and ask for it explicitly.\n',
  );
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
