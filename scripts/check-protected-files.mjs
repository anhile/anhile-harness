#!/usr/bin/env node
/**
 * Content-based protection for the gate's own machinery.
 *
 * The gate already refused writes to these files, but it did so by guessing
 * from the shell command: a regex over redirects and nine verbs
 * (`sed -i|tee|rm|mv|cp|truncate|chmod|ln|install`). `python3` is not one of
 * them, and neither is `node -e`, `perl`, `awk` or a heredoc into any of them.
 * A session that wrote `python3 - <<'PY' … open('verify.sh','w') … PY` went
 * straight through. The existing test passed because it fired the same nine
 * verbs the regex knows — a guard checked against its own reflection.
 *
 * Enumerating interpreters is a losing game. This looks at the files instead:
 *
 *   UserPromptSubmit — the person has spoken, so whatever the files say now is
 *                      what they are accountable for. Record it as the baseline.
 *   PostToolUse      — a tool call finished. If a protected file no longer
 *                      matches the baseline, say so immediately.
 *
 * The baseline is what makes a human's edit and a session's edit distinguishable
 * without asking who typed it. A person editing verify.sh between two messages
 * is re-baselined by their next message and nothing fires. A session editing it
 * mid-turn drifts from a baseline it cannot honestly move.
 *
 * check-commit-gate.mjs recomputes this comparison at commit time rather than
 * reading a flag, so deleting the tripwire does not help; deleting the baseline
 * makes it stricter, because the fallback is HEAD.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

/**
 * The gate's trusted computing base. If a session can rewrite these, the gate
 * says whatever that session wants it to say. This list lives here, and
 * check-commit-gate.mjs imports it, so the two can never disagree about what
 * they are protecting.
 */
const PROTECTED = [
  '.claude/settings.json',
  '.github/workflows/verify.yml',
  'scripts/audit-receipt.mjs',
  'scripts/check-commit-gate.mjs',
  'scripts/check-protected-files.mjs',
  'scripts/verify-receipt.mjs',
  'verify.sh',
];

const BASELINE_FILE = path.join(root, '.generated', 'protected-baseline.json');
const TRIPWIRE_FILE = path.join(root, '.generated', 'protected-tripwire.json');

/** A missing file is a state, not an absence: deleting the gate is a change. */
const ABSENT = 'absent';

function hashOf(relative) {
  try {
    return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex')}`;
  } catch {
    return ABSENT;
  }
}

function hashAll() {
  return Object.fromEntries(PROTECTED.map((file) => [file, hashOf(file)]));
}

/** What HEAD says these files are. The fallback when no baseline was recorded. */
function hashesAtHead() {
  const at = {};
  for (const file of PROTECTED) {
    try {
      // stderr ignored: a file absent from HEAD is an ordinary case here, and
      // git's "fatal:" on it would otherwise land in the hook's own output.
      const blob = execFileSync('git', ['show', `HEAD:${file}`], {
        cwd: root,
        maxBuffer: 1 << 26,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      at[file] = `sha256:${createHash('sha256').update(blob).digest('hex')}`;
    } catch {
      // Not in HEAD: either untracked, or there is no HEAD yet. Neither is a
      // reason to block, and treating it as ABSENT would flag every new file.
      at[file] = hashOf(file);
    }
  }
  return at;
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    if (parsed && typeof parsed.files === 'object') return parsed.files;
  } catch {
    /* fall through to HEAD */
  }
  return null;
}

function writeJson(file, value) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    /* a tripwire that cannot be written must not be the reason work stops */
  }
}

/**
 * Which protected files no longer match what the person last stood behind.
 * Exported, because the commit gate asks the same question at commit time and
 * two implementations of it would eventually answer differently.
 */
function driftFromBaseline() {
  const baseline = readBaseline() ?? hashesAtHead();
  const now = hashAll();
  return PROTECTED.filter((file) => (baseline[file] ?? ABSENT) !== now[file]);
}

function recordBaseline() {
  writeJson(BASELINE_FILE, { at: new Date().toISOString(), files: hashAll() });
  rmSync(TRIPWIRE_FILE, { force: true });
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    // Same rule as the commit gate: a hook that cannot read its input must not
    // be the reason work stops. It fails open here and only here.
    process.exit(0);
  }

  const event = payload.hook_event_name ?? '';

  if (event === 'UserPromptSubmit') {
    recordBaseline();
    process.exit(0);
  }

  if (event !== 'PostToolUse') process.exit(0);

  const drifted = driftFromBaseline();
  if (drifted.length === 0) process.exit(0);

  writeJson(TRIPWIRE_FILE, { at: new Date().toISOString(), files: drifted });
  process.stderr.write(
    `BLOCKED: a protected file changed (docs/INVARIANTS.md I11)\n\n` +
      `${drifted.join('\n')}\n\n` +
      'These files are the gate that decides whether this session may commit, and\n' +
      'a session does not get to edit the rule it is measured against. The write\n' +
      'has already happened — this fires after the tool call, because guessing\n' +
      'which commands write is what let it through in the first place.\n\n' +
      'Do this now:\n' +
      '  1. Put the file back the way it was.\n' +
      '  2. Say what you wanted to change and why, and let the person make the\n' +
      '     edit or lift the hook in .claude/settings.json.\n\n' +
      'Until it matches again, the commit gate will refuse: it recomputes this\n' +
      'comparison rather than trusting a flag, so removing the tripwire file\n' +
      'changes nothing.\n',
  );
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}

export { PROTECTED, driftFromBaseline, hashAll, recordBaseline, BASELINE_FILE, TRIPWIRE_FILE };
