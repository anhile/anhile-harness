/**
 * The commit gate is a guard, and a guard that is never fired at is decoration.
 * These tests build a throwaway repository, copy the gate into it, and check
 * that it blocks what it claims to block -- including the two shapes that
 * actually went wrong in this project: committing on red, and committing a tree
 * that the green run never saw.
 *
 * The gate derives its root from its own file location, so a copy placed in a
 * temporary repository governs that repository. That is also why these tests
 * cannot be written by pointing the real gate at a fake directory: there is no
 * such switch, on purpose.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = [
  'verify-receipt.mjs',
  'audit-receipt.mjs',
  'audit-log.mjs',
  'check-commit-gate.mjs',
  'check-protected-files.mjs',
  'verify-log.mjs',
  'spike.mjs',
];

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function node(script: string, ...args: string[]): string {
  return execFileSync('node', [path.join(repo, 'scripts', script), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

type Verdict = { blocked: boolean; reason: string };

/** execFileSync throws on a non-zero exit, so a block arrives as an exception. */
function runGate(payload: unknown): Verdict {
  try {
    execFileSync('node', [path.join(repo, 'scripts', 'check-commit-gate.mjs')], {
      cwd: repo,
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    return { blocked: false, reason: '' };
  } catch (error) {
    const err = error as { status?: number; stderr?: string };
    if (err.status !== 2) throw error;
    return { blocked: true, reason: String(err.stderr ?? '') };
  }
}

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

function writeReceipt(status: 'pass' | 'fail', failed = ''): void {
  const before = node('verify-receipt.mjs', 'hash').trim();
  node(
    'verify-receipt.mjs',
    'write',
    '--status', status,
    '--evidence', '.evidence/test',
    '--tree-before', before,
    '--failed', failed,
  );
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'commit-gate-'));
  mkdirSync(path.join(repo, 'scripts'));
  for (const script of SCRIPTS) {
    copyFileSync(path.join(REPO, 'scripts', script), path.join(repo, 'scripts', script));
  }
  // The receipt describes the tree; it must not be part of the tree it
  // describes, or writing it would invalidate itself.
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeFileSync(path.join(repo, 'verify.sh'), '#!/usr/bin/env bash\n');
  mkdirSync(path.join(repo, 'verify-log'));
  writeFileSync(
    path.join(repo, 'verify-log', '20260830T100000Z.json'),
    `${JSON.stringify({ at: '2026-08-30T10:00:00.000Z', result: 'pass', tree: 'sha256:aaa', steps: {} })}\n`,
  );
  writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 42;\n');
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-qm', 'initial');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('a spike branch is asked for no receipt (I16)', () => {
  it('lets a commit through with no receipt at all, and says why on stderr', () => {
    git('checkout', '-qb', 'spike/try-sqlite');
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    git('add', 'source.ts');
    expect(runGate(bash('git commit -m "trying"'))).toEqual({ blocked: false, reason: '' });
  });

  it('lets a commit through on red, since the spike claims nothing the run would have to back', () => {
    git('checkout', '-qb', 'spike/try-sqlite');
    writeReceipt('fail', '03-unit');
    expect(runGate(bash('git commit -m "red and honest about it"')).blocked).toBe(false);
  });

  it('still refuses the protected files: a spike edits the gate no more than any branch', () => {
    git('checkout', '-qb', 'spike/try-sqlite');
    const verdict = runGate({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'verify.sh'), old_string: 'a', new_string: 'b' } });
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('I11');
  });

  it('asks the receipt again the moment the branch is not a spike', () => {
    git('checkout', '-qb', 'spike-without-the-slash');
    expect(runGate(bash('git commit -m x')).reason).toContain('No verify receipt');
  });
});

describe('what counts as creating a commit', () => {
  it('lets unrelated commands through', () => {
    for (const command of ['git status', 'git log --oneline', 'pnpm verify', 'ls -la']) {
      expect(runGate(bash(command)).blocked).toBe(false);
    }
  });

  it('does not mistake the words for the act', () => {
    expect(runGate(bash('echo "git commit -m nope"')).blocked).toBe(false);
    expect(runGate(bash('grep -rn "git commit" docs/')).blocked).toBe(false);
  });

  it('sees a commit however it is dressed', () => {
    const commands = [
      'git commit -m "x"',
      'git commit --amend --no-edit',
      'cd apps/api && git commit -m "x"',
      'git add -A && git commit -m "x"',
      'git -C . commit -m "x"',
      'GIT_AUTHOR_NAME=someone git commit -m "x"',
      'git -c user.name=x commit -m "y"',
    ];
    for (const command of commands) {
      expect([command, runGate(bash(command)).blocked]).toEqual([command, true]);
    }
  });
});

describe('the verdict it requires', () => {
  it('blocks when nothing has verified the tree at all', () => {
    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('No verify receipt');
  });

  it('blocks on a failed run, and names the failing steps', () => {
    writeReceipt('fail', '02-typecheck,03-unit');
    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('FAILED');
    expect(verdict.reason).toContain('02-typecheck, 03-unit');
  });

  it('allows a commit when the run passed against this exact tree', () => {
    writeReceipt('pass');
    expect(runGate(bash('git commit -m "x"')).blocked).toBe(false);
  });
});

describe('the verdict must be about the tree being committed', () => {
  it('blocks once a source file has changed, and names it', () => {
    writeReceipt('pass');
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');

    const verdict = runGate(bash('git commit -am "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('not against this tree');
    expect(verdict.reason).toContain('source.ts');
  });

  it('blocks when a tracked file has been deleted', () => {
    writeReceipt('pass');
    rmSync(path.join(repo, 'source.ts'));
    expect(runGate(bash('git commit -am "x"')).blocked).toBe(true);
  });

  it('blocks a run whose tree moved while the steps were running', () => {
    // What `--tree-before` catches: a hash from before the steps that no longer
    // matches the tree after them.
    node('verify-receipt.mjs', 'write', '--status', 'pass',
      '--evidence', '.evidence/test', '--tree-before', 'sha256:something-else');
    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('while');
  });

  it('still allows the commit after staging a new file', () => {
    // The property the whole design rests on. `git add` moves a file from
    // untracked to staged without changing any content, so a verify run from
    // before the staging still describes the tree being committed. Hashing the
    // index alone would make every commit of a new file unverifiable.
    writeFileSync(path.join(repo, 'added.ts'), 'export const added = true;\n');
    writeReceipt('pass');
    git('add', 'added.ts');
    expect(runGate(bash('git commit -m "x"')).blocked).toBe(false);
  });
});

describe('the commit must contain the tree that was verified', () => {
  it('refuses while an untracked file is present — the case the hash cannot see', () => {
    // An untracked file is in the hashed set before and after, so the receipt
    // matches perfectly while the commit leaves the file out. This is how
    // commit 925eb56 was made, and why CI's attestation refused it.
    writeFileSync(path.join(repo, 'notes.md'), 'not staged, not committed\n');
    writeReceipt('pass');

    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('not tracked, so not in the commit');
    expect(verdict.reason).toContain('notes.md');
  });

  it('allows it once the file is staged', () => {
    writeFileSync(path.join(repo, 'notes.md'), 'staged now\n');
    writeReceipt('pass');
    git('add', 'notes.md');

    expect(runGate(bash('git commit -m "x"')).blocked).toBe(false);
  });

  it('ignores a file .gitignore excludes', () => {
    writeFileSync(path.join(repo, '.gitignore'), '.generated/\nscratch/\n');
    git('add', '-A');
    git('commit', '-qm', 'ignore scratch');
    mkdirSync(path.join(repo, 'scratch'));
    writeFileSync(path.join(repo, 'scratch', 'junk.txt'), 'noise\n');
    writeReceipt('pass');

    expect(runGate(bash('git commit -m "x"')).blocked).toBe(false);
  });

  it('refuses a partially staged change, and allows it under git commit -a', () => {
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 44;\n');
    git('add', 'source.ts');
    // Staged, then edited again: the index and the working tree now differ.
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 45;\n');
    writeReceipt('pass');

    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('changed since they were staged');

    // -a stages tracked modifications itself, so the commit does carry them.
    expect(runGate(bash('git commit -am "x"')).blocked).toBe(false);
  });
});

describe('the durable record cannot be edited around the gate', () => {
  it('refuses a commit when a recorded run has been rewritten', () => {
    // verify-log/ sits outside the tree hash on purpose -- verify.sh records
    // a run there at the end of every run -- so the hash alone would not
    // notice this. The gate runs the record's own guard for exactly that window.
    writeReceipt('pass');
    writeFileSync(
      path.join(repo, 'verify-log', '20260830T100000Z.json'),
      `${JSON.stringify({ at: '2026-08-30T10:00:00.000Z', result: 'pass', tree: 'sha256:zzz', steps: {} })}\n`,
    );

    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('rewritten, not appended');
  });

  it('refuses a commit when a recorded run has been removed', () => {
    writeReceipt('pass');
    rmSync(path.join(repo, 'verify-log', '20260830T100000Z.json'));
    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('rewritten, not appended');
  });

  it('refuses a commit when a recorded audit has been rewritten', () => {
    // audit-log/ is outside the tree hash for the same reason verify-log/ is,
    // and gets the same guard in the gate, since the hash cannot see it.
    mkdirSync(path.join(repo, 'audit-log'));
    const audit = path.join(repo, 'audit-log', '20260914T080000.000Z.json');
    writeFileSync(audit, `${JSON.stringify({ spec: 'specs/x.md', verdict: 'NOT_READY', at: '2026-09-14T08:00:00.000Z', treeHash: 'sha256:aaa' })}\n`);
    git('add', '-A');
    git('commit', '-qm', 'an audit on record');
    writeFileSync(audit, `${JSON.stringify({ spec: 'specs/x.md', verdict: 'READY', at: '2026-09-14T08:00:00.000Z', treeHash: 'sha256:aaa' })}\n`);
    git('add', '-A');
    writeReceipt('pass');
    const verdict = runGate(bash('git commit -m "a better verdict"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('audit-log/ has been rewritten');
    expect(verdict.reason).toContain('20260914T080000.000Z.json was rewritten');
  });

  it('refuses a commit when a recorded audit has been removed', () => {
    mkdirSync(path.join(repo, 'audit-log'));
    const audit = path.join(repo, 'audit-log', '20260914T080000.000Z.json');
    writeFileSync(audit, `${JSON.stringify({ spec: 'specs/x.md', verdict: 'NOT_READY', at: '2026-09-14T08:00:00.000Z', treeHash: 'sha256:aaa' })}\n`);
    git('add', '-A');
    git('commit', '-qm', 'an audit on record');
    rmSync(audit);
    git('add', '-A');
    writeReceipt('pass');
    const verdict = runGate(bash('git commit -m "never happened"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('20260914T080000.000Z.json was removed');
  });

  it('refuses a commit when something that is not a run sits under verify-log/', () => {
    writeReceipt('pass');
    writeFileSync(path.join(repo, 'verify-log', 'notes.json'), '{}\n');
    const verdict = runGate(bash('git commit -m "x"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('rewritten, not appended');
  });

  it('allows a commit that only records a run', () => {
    writeReceipt('pass');
    writeFileSync(
      path.join(repo, 'verify-log', '20260830T120000Z.json'),
      `${JSON.stringify({ at: '2026-08-30T12:00:00.000Z', result: 'fail', tree: 'sha256:bbb', steps: {} })}\n`,
    );
    // Staged, as `git add -A` does before a real commit: an unstaged change is
    // refused separately, because the commit would not carry it.
    git('add', 'verify-log');
    expect(runGate(bash('git commit -m "x"')).blocked).toBe(false);
  });
});

describe('the gate protects its own machinery', () => {
  it('refuses an Edit aimed at the gate', () => {
    for (const file of ['verify.sh', 'scripts/check-commit-gate.mjs', '.claude/settings.json']) {
      const verdict = runGate({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, file) } });
      expect([file, verdict.blocked]).toEqual([file, true]);
    }
  });

  it('leaves ordinary files alone', () => {
    const verdict = runGate({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'source.ts') } });
    expect(verdict.blocked).toBe(false);
  });

  it('refuses a shell command that writes to the gate', () => {
    const commands = [
      "sed -i '' 's/exit 1/exit 0/' verify.sh",
      'echo "exit 0" > verify.sh',
      'cat template.json >> .claude/settings.json',
      'rm scripts/check-commit-gate.mjs',
      'cp /dev/null verify.sh',
    ];
    for (const command of commands) {
      expect([command, runGate(bash(command)).blocked]).toEqual([command, true]);
    }
  });

  it('still allows reading the gate', () => {
    for (const command of ['cat verify.sh', 'grep -n exit verify.sh', 'bash -n verify.sh']) {
      expect([command, runGate(bash(command)).blocked]).toEqual([command, false]);
    }
  });
});

describe('protection that reads the files instead of the command', () => {
  // The regex above knows nine verbs. This is the shape that walked through it
  // in this repository on 2026-09-01: an interpreter, no redirect, no verb.
  const pythonWrite = `python3 - <<'PY'\nopen('verify.sh','w').write('exit 0\\n')\nPY`;

  function protectedFiles(payload: unknown): Verdict {
    try {
      execFileSync('node', [path.join(repo, 'scripts', 'check-protected-files.mjs')], {
        cwd: repo,
        input: JSON.stringify(payload),
        encoding: 'utf8',
      });
      return { blocked: false, reason: '' };
    } catch (error) {
      const err = error as { status?: number; stderr?: string };
      if (err.status !== 2) throw error;
      return { blocked: true, reason: String(err.stderr ?? '') };
    }
  }

  const prompt = () => protectedFiles({ hook_event_name: 'UserPromptSubmit' });
  const afterTool = () => protectedFiles({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });

  it('the command-shaped check does not see an interpreter — which is why this exists', () => {
    // Documenting the hole rather than pretending it closed. If someone teaches
    // shellWritesTo about python, this test is the one that should argue back.
    expect(runGate(bash(pythonWrite)).blocked).toBe(false);
  });

  it('notices the write after the fact, whatever wrote it', () => {
    prompt();
    writeFileSync(path.join(repo, 'verify.sh'), '#!/usr/bin/env bash\nexit 0\n');
    const verdict = afterTool();
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('verify.sh');
  });

  it('says nothing while the protected files are untouched', () => {
    prompt();
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    expect(afterTool().blocked).toBe(false);
  });

  it('treats deleting a protected file as changing it', () => {
    prompt();
    rmSync(path.join(repo, 'verify.sh'));
    expect(afterTool().blocked).toBe(true);
  });

  it('lets a person edit the gate between two messages', () => {
    // The asymmetry the whole gate is built on: it binds the session, not the
    // human. Their next message is what re-baselines these files.
    prompt();
    writeFileSync(path.join(repo, 'verify.sh'), '#!/usr/bin/env bash\n# by a person\n');
    expect(afterTool().blocked).toBe(true);
    prompt();
    expect(afterTool().blocked).toBe(false);
  });
});

describe('the commit gate recomputes rather than trusting a flag', () => {
  // The receipt is written AFTER the edit, on purpose. Written before, the tree
  // hash goes stale and the gate blocks for that reason instead -- which is how
  // the first version of these tests passed against a gate that had none of
  // this in it, asserting on a message that happened to name the same file.
  function driftThenVerify(): void {
    execFileSync('node', [path.join(repo, 'scripts', 'check-protected-files.mjs')], {
      cwd: repo,
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit' }),
      encoding: 'utf8',
    });
    writeFileSync(path.join(repo, 'verify.sh'), '#!/usr/bin/env bash\nexit 0\n');
    // Staged and verified, so the tree-hash and unstaged-file refusals are both
    // out of the way. What is left for the gate to object to is the content.
    git('add', '-A');
    writeReceipt('pass');
  }

  const COMMIT = ['git', 'commit', '-m', 'x'].join(' ');
  /** Text only the content check produces, so a stale-tree block cannot pass for it. */
  const ITS_OWN_WORDS = 'a protected file changed in this session';

  it('refuses a commit whose tree is verified but whose gate was edited', () => {
    driftThenVerify();
    const verdict = runGate(bash(COMMIT));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain(ITS_OWN_WORDS);
    expect(verdict.reason).toContain('verify.sh');
  });

  it('removing the tripwire does not unblock it', () => {
    driftThenVerify();
    rmSync(path.join(repo, '.generated', 'protected-tripwire.json'), { force: true });
    expect(runGate(bash(COMMIT)).reason).toContain(ITS_OWN_WORDS);
  });

  it('removing the baseline makes it stricter, not weaker — the fallback is HEAD', () => {
    driftThenVerify();
    rmSync(path.join(repo, '.generated', 'protected-baseline.json'), { force: true });
    expect(runGate(bash(COMMIT)).reason).toContain(ITS_OWN_WORDS);
  });

  it('an ordinary commit on a verified tree still goes through', () => {
    execFileSync('node', [path.join(repo, 'scripts', 'check-protected-files.mjs')], {
      cwd: repo,
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit' }),
      encoding: 'utf8',
    });
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    git('add', '-A');
    writeReceipt('pass');
    expect(runGate(bash(COMMIT)).blocked).toBe(false);
  });
});

describe('the gate is actually wired up', () => {
  // The script being correct is worth nothing if nothing invokes it. This is
  // the half that a unit test can still see: that the real settings file names
  // the real script. Whether Claude Code accepts the schema is only observable
  // by restarting a session, so it is stated in docs/INVARIANTS.md I11 as the
  // one part of this gate that a human confirms rather than a test.
  it('registers the gate as a PreToolUse hook over the tools that can commit', () => {
    const settings = JSON.parse(
      readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8'),
    ) as { hooks?: { PreToolUse?: { matcher?: string; hooks?: { command?: string }[] }[] } };

    const entries = settings.hooks?.PreToolUse ?? [];
    const commands = entries.flatMap((entry) => (entry.hooks ?? []).map((h) => h.command ?? ''));
    expect(commands.some((c) => c.includes('check-commit-gate.mjs'))).toBe(true);

    const matchers = entries
      .filter((entry) => (entry.hooks ?? []).some((h) => (h.command ?? '').includes('check-commit-gate.mjs')))
      .map((entry) => entry.matcher ?? '');
    // Bash is how a commit is made; the edit tools are how the gate is removed.
    for (const tool of ['Bash', 'Edit', 'Write']) {
      expect(matchers.some((m) => m.split('|').includes(tool))).toBe(true);
    }
  });
});

describe('a closing commit needs the audit receipt', () => {
  // Added 2026-09-08. Ninety entries closed before either reviewer ever ran;
  // the gate now reads .generated/audit.json before a commit whose index flips
  // an entry to passing, and requires it to name this tree, this entry's
  // contract, and READY. Any other commit is untouched.
  const SPEC = 'specs/2026-09-thing.md';
  const list = (open: boolean) =>
    `${JSON.stringify([{ id: 0, category: 'x', description: 'the one', steps: ['s'], passes: !open, spec: SPEC }], null, 2)}\n`;

  function commitOpenEntry(): void {
    mkdirSync(path.join(repo, 'specs'), { recursive: true });
    writeFileSync(path.join(repo, SPEC), '# the contract\n');
    writeFileSync(path.join(repo, 'feature_list.json'), list(true));
    git('add', '-A');
    git('commit', '-qm', 'open an entry');
  }

  function stageClose(): void {
    writeFileSync(path.join(repo, 'feature_list.json'), list(false));
    git('add', '-A');
  }

  it('refuses the flip with no audit, and says which entry and what to run', () => {
    commitOpenEntry();
    stageClose();
    writeReceipt('pass');
    const verdict = runGate(bash('git commit -m "close"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('a closing commit needs the audit');
    expect(verdict.reason).toContain('#0 — the one');
    expect(verdict.reason).toContain(`/verify-task ${SPEC}`);
  });

  it('allows the flip once the audit says READY about this tree and this contract', () => {
    commitOpenEntry();
    stageClose();
    writeReceipt('pass');
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    // The audit is now also a file under audit-log/, and a closing commit
    // carries it: staged, like everything else, or the gate says the commit
    // would not contain the tree that was verified.
    expect(runGate(bash('git commit -m "close"')).reason).toContain('audit-log/');
    git('add', '-A');
    expect(runGate(bash('git commit -m "close"')).blocked).toBe(false);
  });

  it('refuses a NOT_READY audit, and one of another contract', () => {
    commitOpenEntry();
    stageClose();
    writeReceipt('pass');
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'NOT_READY');
    expect(runGate(bash('git commit -m "close"')).reason).toContain('NOT_READY, not READY');
    node('audit-receipt.mjs', 'write', '--spec', 'specs/2026-09-other.md', '--verdict', 'READY');
    expect(runGate(bash('git commit -m "close"')).reason).toContain('the audit was of specs/2026-09-other.md');
  });

  it('refuses an audit of a tree that has since moved, even with a fresh verify receipt', () => {
    commitOpenEntry();
    stageClose();
    writeReceipt('pass');
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    git('add', '-A');
    writeReceipt('pass');
    const verdict = runGate(bash('git commit -m "close"'));
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('the audit was about tree');
  });

  it('asks nothing of a commit that closes no entry', () => {
    commitOpenEntry();
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    git('add', '-A');
    writeReceipt('pass');
    expect(runGate(bash('git commit -m "work"')).blocked).toBe(false);
  });
});
