/**
 * verify-log.jsonl is the durable half of the evidence: .evidence/ is ignored,
 * so this file is the only record of a past run that survives a clone. Its
 * append-only rule is what makes a recorded PASS worth reading — a record a
 * session can rewrite says whatever that session wants it to say.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'verify-log.mjs'];
const LOG = 'verify-log.jsonl';

let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

function run(entry: Record<string, unknown>): string {
  return `${JSON.stringify({
    at: '2026-08-30T10:00:00.000Z',
    result: 'pass',
    tree: 'sha256:aaa',
    steps: { '01-eslint': { exit: 0, seconds: 1 } },
    ...entry,
  })}\n`;
}

function writeLog(...entries: string[]): void {
  writeFileSync(path.join(repo, LOG), entries.join(''));
}

type Verdict = { rejected: boolean; reason: string };

function check(): Verdict {
  try {
    execFileSync('node', [path.join(repo, 'scripts', 'verify-log.mjs'), 'check'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { rejected: false, reason: '' };
  } catch (error) {
    const err = error as { status?: number; stderr?: string };
    if (err.status !== 1) throw error;
    return { rejected: true, reason: String(err.stderr ?? '') };
  }
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'verify-log-'));
  mkdirSync(path.join(repo, 'scripts'));
  for (const script of SCRIPTS) {
    copyFileSync(path.join(REPO, 'scripts', script), path.join(repo, 'scripts', script));
  }
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeLog(run({ at: '2026-08-30T10:00:00.000Z' }), run({ at: '2026-08-30T11:00:00.000Z' }));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-qm', 'two runs on record');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('what the record accepts', () => {
  it('accepts the file exactly as committed', () => {
    expect(check().rejected).toBe(false);
  });

  it('accepts a new run appended at the end', () => {
    writeLog(
      run({ at: '2026-08-30T10:00:00.000Z' }),
      run({ at: '2026-08-30T11:00:00.000Z' }),
      run({ at: '2026-08-30T12:00:00.000Z', result: 'fail' }),
    );
    expect(check().rejected).toBe(false);
  });
});

describe('what the record refuses', () => {
  it('refuses a deleted run', () => {
    writeLog(run({ at: '2026-08-30T10:00:00.000Z' }));
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('never removed');
  });

  it('refuses a rewritten run — the shape that would turn a red run green', () => {
    writeLog(
      run({ at: '2026-08-30T10:00:00.000Z' }),
      run({ at: '2026-08-30T11:00:00.000Z', result: 'pass', steps: { '02-typecheck': { exit: 0, seconds: 2 } } }),
    );
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('rewritten');
  });

  it('refuses an emptied record', () => {
    writeLog();
    expect(check().rejected).toBe(true);
  });

  it('refuses a line that is not valid JSON', () => {
    writeLog(run({}), run({ at: '2026-08-30T11:00:00.000Z' }), 'not json at all\n');
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('not valid JSON');
  });

  it('refuses a line missing the fields that make it evidence', () => {
    const bare = `${JSON.stringify({ at: '2026-08-30T12:00:00.000Z' })}\n`;
    writeLog(run({}), run({ at: '2026-08-30T11:00:00.000Z' }), bare);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('missing: result, tree, steps');
  });

  it('refuses a run backdated above a later one', () => {
    writeLog(
      run({ at: '2026-08-30T10:00:00.000Z' }),
      run({ at: '2026-08-30T11:00:00.000Z' }),
      run({ at: '2026-08-29T09:00:00.000Z' }),
    );
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('dated before');
  });
});

describe('the record in this repository', () => {
  it('is append-only against HEAD right now', () => {
    execFileSync('node', [path.join(REPO, 'scripts', 'verify-log.mjs'), 'check'], {
      cwd: REPO,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  });

  it('is not swept up by .gitignore, directly or through .evidence', () => {
    // check-ignore exits 1 when the path is not ignored, which is the state
    // this test wants: the raw evidence stays out, the record stays in.
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', LOG], { cwd: REPO, stdio: 'ignore' });
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(false);
  });
});

describe('flakes: a step that failed and passed on the same tree', () => {
  // Run against the copied script in the throwaway repo, so the row it prints
  // comes from a log this test wrote and not from the project's own record.
  function flakesOf(...entries: string[]): string {
    writeLog(...entries);
    return execFileSync('node', [path.join(repo, 'scripts', 'verify-log.mjs'), 'flakes', '3650'], {
      cwd: repo,
      encoding: 'utf8',
    });
  }
  const failed = (tree: string, step: string, at: string) =>
    run({ result: 'fail', tree, at, steps: { [step]: { exit: 1, seconds: 1 }, '01-eslint': { exit: 0, seconds: 1 } } });
  const passed = (tree: string, at: string) => run({ result: 'pass', tree, at });

  it('names the step, once per failing run, when the same tree later passed', () => {
    const out = flakesOf(
      failed('sha256:t1', '05-browser-e2e', '2026-09-03T06:38:00.000Z'),
      failed('sha256:t1', '05-browser-e2e', '2026-09-03T06:50:00.000Z'),
      passed('sha256:t1', '2026-09-03T07:05:00.000Z'),
    );
    expect(out).toMatch(/05-browser-e2e\s+1\s+2\s+2026-09-03T06:50:00.000Z/u);
  });

  it('does not count a tree that only ever failed: that is a real failure', () => {
    const out = flakesOf(
      failed('sha256:t2', '03-unit', '2026-09-03T05:37:00.000Z'),
      failed('sha256:t2', '03-unit', '2026-09-03T05:41:00.000Z'),
    );
    expect(out).toContain('no step has both failed and passed');
  });

  it('counts a step per tree it flaked on, across trees', () => {
    const out = flakesOf(
      failed('sha256:t3', '04-api-e2e', '2026-09-01T00:00:00.000Z'),
      passed('sha256:t3', '2026-09-01T00:10:00.000Z'),
      failed('sha256:t4', '04-api-e2e', '2026-09-02T00:00:00.000Z'),
      passed('sha256:t4', '2026-09-02T00:10:00.000Z'),
    );
    expect(out).toMatch(/04-api-e2e\s+2\s+2\s+/u);
  });

  it('a pass followed by a fail on the same tree is a flake too: order does not matter', () => {
    const out = flakesOf(
      passed('sha256:t5', '2026-09-01T00:00:00.000Z'),
      failed('sha256:t5', '02-typecheck', '2026-09-01T00:10:00.000Z'),
    );
    expect(out).toMatch(/02-typecheck\s+1\s+1\s+/u);
  });
});
