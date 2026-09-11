/**
 * verify-log/ is the durable half of the evidence: .generated/ is ignored, so
 * the run files are the only record of a past run that survives a clone.
 * Their append-only rule — a recorded run's file is never edited and never
 * removed — is what makes a recorded PASS worth reading; a record a session
 * can rewrite says whatever that session wants it to say.
 *
 * One file per run since 2026-09-12. The record was one append-only file for
 * two weeks, and two branches that both ran the gate conflicted at its end on
 * every merge. The last describe here is the case that decided it.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'verify-log.mjs'];
const LOG = 'verify-log';

let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

/** A run file's name is its id: the evidence folder's UTC timestamp. */
const idOf = (at: string) => `${at.replace(/[-:.]/gu, '').slice(0, 15)}Z`;

type Entry = Record<string, unknown> & { at: string };

function run(entry: Partial<Entry> & { at: string }): Entry {
  return {
    result: 'pass',
    tree: 'sha256:aaa',
    steps: { '01-eslint': { exit: 0, seconds: 1 } },
    ...entry,
  };
}

/** Writes the record from scratch: one file per entry, named by its `at`. */
function writeRuns(...entries: Entry[]): void {
  rmSync(path.join(repo, LOG), { recursive: true, force: true });
  mkdirSync(path.join(repo, LOG));
  for (const e of entries) writeFileSync(path.join(repo, LOG, `${idOf(e.at)}.json`), `${JSON.stringify(e, null, 2)}\n`);
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

const first = run({ at: '2026-08-30T10:00:00.000Z' });
const second = run({ at: '2026-08-30T11:00:00.000Z' });

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'verify-log-'));
  mkdirSync(path.join(repo, 'scripts'));
  for (const script of SCRIPTS) {
    copyFileSync(path.join(REPO, 'scripts', script), path.join(repo, 'scripts', script));
  }
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeRuns(first, second);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-qm', 'two runs on record');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('what the record accepts', () => {
  it('accepts the directory exactly as committed', () => {
    expect(check().rejected).toBe(false);
  });

  it('accepts a new run recorded beside the others', () => {
    writeRuns(first, second, run({ at: '2026-08-30T12:00:00.000Z', result: 'fail' }));
    expect(check().rejected).toBe(false);
  });

  it('accepts a new run whose timestamp is earlier than an existing one', () => {
    // Two branches record runs in their own time; when they merge, the
    // directory holds both orders. Nothing about order is a rule any more.
    writeRuns(first, second, run({ at: '2026-08-30T09:00:00.000Z' }));
    expect(check().rejected).toBe(false);
  });
});

describe('what the record refuses', () => {
  it('refuses a removed run', () => {
    writeRuns(first);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain(`run ${idOf(second.at)}.json was removed`);
  });

  it('refuses a rewritten run — the shape that would turn a red run green', () => {
    writeRuns(first, run({ at: second.at, result: 'pass', tree: 'sha256:zzz' }));
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain(`run ${idOf(second.at)}.json was rewritten`);
  });

  it('refuses an emptied record', () => {
    writeRuns();
    expect(check().rejected).toBe(true);
  });

  it('refuses a file that is not valid JSON', () => {
    writeFileSync(path.join(repo, LOG, '20260830T120000Z.json'), '{ not json\n');
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('is not valid JSON');
  });

  it('refuses a file missing the fields that make it evidence', () => {
    writeFileSync(path.join(repo, LOG, '20260830T120000Z.json'), `${JSON.stringify({ at: '2026-08-30T12:00:00.000Z' })}\n`);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('is missing: result, tree, steps');
  });

  it('refuses a run dated before it started, which is what is left of the rule against backdating', () => {
    writeFileSync(
      path.join(repo, LOG, '20260830T120000Z.json'),
      `${JSON.stringify(run({ at: '2026-08-30T11:59:00.000Z' }), null, 2)}\n`,
    );
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('run 20260830T120000Z.json is dated 2026-08-30T11:59:00.000Z, before it started');
  });

  it('refuses a file that is not named as a run, which is a record nothing wrote or a run renamed', () => {
    writeFileSync(path.join(repo, LOG, 'notes.json'), '{}\n');
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.reason).toContain('verify-log/notes.json is not a run');
  });
});

describe('the record in this repository', () => {
  it('is append-only against HEAD right now', () => {
    execFileSync('node', [path.join(REPO, 'scripts', 'verify-log.mjs'), 'check'], { cwd: REPO, encoding: 'utf8' });
  });

  it('is not swept up by .gitignore', () => {
    const files = readdirSync(path.join(REPO, LOG)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', path.join(LOG, files[0] ?? '')], { cwd: REPO, stdio: 'ignore' });
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(false);
  });
});

describe('two branches that both ran the gate', () => {
  // The case that turned one file into a directory. Both branches record a
  // run; with a single append-only file the merge conflicted at its end every
  // time, and the fix was to rerun the gate before every merge. Files with
  // distinct names merge cleanly, and the guard accepts the result against
  // either parent.
  it('merge without a conflict, and the merged record passes the guard against both parents', () => {
    git('checkout', '-qb', 'work');
    writeRuns(first, second, run({ at: '2026-08-30T12:00:00.000Z', tree: 'sha256:work' }));
    git('add', '-A');
    git('commit', '-qm', 'a run on the branch');
    git('checkout', '-q', 'main');
    writeRuns(first, second, run({ at: '2026-08-30T13:00:00.000Z', tree: 'sha256:main' }));
    git('add', '-A');
    git('commit', '-qm', 'a later run on main');
    git('merge', '-q', '--no-ff', '-m', 'merge work', 'work');
    expect(readdirSync(path.join(repo, LOG)).sort()).toEqual([
      '20260830T100000Z.json',
      '20260830T110000Z.json',
      '20260830T120000Z.json',
      '20260830T130000Z.json',
    ]);
    for (const parent of ['HEAD^', 'HEAD^2']) {
      execFileSync('node', [path.join(repo, 'scripts', 'verify-log.mjs'), 'check', '--at', 'HEAD', '--base', parent], {
        cwd: repo,
        encoding: 'utf8',
      });
    }
  });
});

describe('migrate: the record\'s earlier shape into files', () => {
  // verify-log.jsonl, one line per run, was the record until 2026-09-12. A
  // project on an earlier version runs this once after taking the scripts.
  const lines = [
    { ...first, evidence: '.generated/runs/20260830T100000Z' },
    { ...second, evidence: '.generated/runs/20260830T110000Z', result: 'fail' },
    { ...run({ at: '2026-08-30T12:00:00.000Z' }), evidence: '.generated/runs/20260830T120000Z' },
  ];
  const migrate = () =>
    execFileSync('node', [path.join(repo, 'scripts', 'verify-log.mjs'), 'migrate'], { cwd: repo, encoding: 'utf8' });

  it('writes one file per line with the same fields, and removes the file', () => {
    rmSync(path.join(repo, LOG), { recursive: true, force: true });
    writeFileSync(path.join(repo, 'verify-log.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(migrate()).toContain('3 run(s) in verify-log.jsonl, 3 file(s) written, the file removed');
    expect(existsSync(path.join(repo, 'verify-log.jsonl'))).toBe(false);
    for (const l of lines) {
      const file = path.join(repo, LOG, `${path.basename(l.evidence as string)}.json`);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(l);
    }
  });

  it('is a no-op the second time, and refuses to overwrite a file that differs', () => {
    rmSync(path.join(repo, LOG), { recursive: true, force: true });
    writeFileSync(path.join(repo, 'verify-log.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    migrate();
    expect(migrate()).toContain('no verify-log.jsonl to migrate');
    writeFileSync(path.join(repo, 'verify-log.jsonl'), `${JSON.stringify({ ...lines[0], result: 'stale' })}\n`);
    expect(() => migrate()).toThrow(/exists and differs/u);
    expect(JSON.parse(readFileSync(path.join(repo, LOG, '20260830T100000Z.json'), 'utf8')).result).toBe('pass');
  });
});

describe('flakes: a step that failed and passed on the same tree', () => {
  // Run against the copied script in the throwaway repo, so the row it prints
  // comes from a record this test wrote and not from the project's own.
  function flakesOf(...entries: Entry[]): string {
    writeRuns(...entries);
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
