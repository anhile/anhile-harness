import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The branch-level gate. Every other guard here asks about one commit or one
 * tree; this one asks whether a *branch* can become a pull request, and the
 * question it exists for is the merge order.
 *
 * The record is a file per run since 2026-09-12; see the last describe.
 * branch whose newest gate run predates main's cannot be merged at all: one
 * resolution of the conflict moves a line main already had, the other goes
 * backwards in time, and the guard refuses both. Measured both ways on
 * 2026-09-11. Catching it here costs a line of output; catching it at merge
 * time costs a person staring at conflict markers with no correct resolution
 * available.
 *
 * Driven as a process against throwaway repositories, which is how this
 * project tests its `.mjs` scripts: ts-jest compiles to CommonJS and cannot
 * import an ES module.
 */
const REPO = path.resolve(__dirname, '..', '..');
// Deliberately not the repository's own copy. check-pr-ready.mjs derives its
// root from its own location, never from the caller's cwd — a root the caller
// can point elsewhere is a root that can be pointed at a forged receipt — so
// running the real file would answer about *this* repository no matter what
// cwd it was given. Every case runs the copy inside its own fixture.
const scriptIn = (dir: string) => path.join(dir, 'scripts', 'check-pr-ready.mjs');

type Result = { ok: boolean; refusals: string[] };

/** A repository with one commit on `main` and whatever else the case needs. */
function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-ready-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '--initial-branch=main', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  // The script reads verify-receipt.mjs from its own location, so the scripts
  // it needs are copied rather than the whole repository.
  mkdirSync(path.join(dir, 'scripts'));
  // check-main.mjs since 2026-09-11: check-pr-ready reports whether main is
  // green, so the fixture needs it beside the script or the script cannot load.
  for (const f of ['check-pr-ready.mjs', 'verify-receipt.mjs', 'check-main.mjs']) {
    copyFileSync(path.join(REPO, 'scripts', f), path.join(dir, 'scripts', f));
  }
  // Without this the receipt written below makes the tree dirty, and every
  // case fails on that instead of on what it is about.
  writeFileSync(path.join(dir, '.gitignore'), '.generated/\n');
  writeFileSync(path.join(dir, 'PROGRESS.md'), '# journal\n');
  mkdirSync(path.join(dir, 'verify-log'));
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

/** One recorded run, named as verify.sh names an evidence folder. */
function logLine(dir: string, at: string): void {
  // Git keeps no empty directory, so after a checkout the record's directory
  // exists only once a run has been recorded in it.
  mkdirSync(path.join(dir, 'verify-log'), { recursive: true });
  writeFileSync(
    path.join(dir, 'verify-log', `${at.replace(/[-:.]/gu, '').slice(0, 15)}Z.json`),
    `${JSON.stringify({ at, result: 'pass', tree: 'sha256:x', steps: {} })}\n`,
  );
}

/** A receipt that matches the tree as it stands right now. */
function receipt(dir: string, status = 'pass'): void {
  const hash = execFileSync('node', [path.join(dir, 'scripts', 'verify-receipt.mjs'), 'hash'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  mkdirSync(path.join(dir, '.generated'), { recursive: true });
  writeFileSync(
    path.join(dir, '.generated', 'receipt.json'),
    JSON.stringify({ status, treeHash: hash }),
  );
}

function run(dir: string): Result {
  try {
    const out = execFileSync('node', [scriptIn(dir), '--json'], { cwd: dir, encoding: 'utf8' });
    return JSON.parse(out) as Result;
  } catch (error) {
    const failure = error as { stdout?: string };
    return JSON.parse(failure.stdout ?? '{"ok":false,"refusals":["no output"]}') as Result;
  }
}

/** The shortest path to a branch this guard should accept. */
function readyBranch(): string {
  const dir = repo();
  git(dir, 'checkout', '-qb', 'some-work');
  writeFileSync(path.join(dir, 'PROGRESS.md'), '# journal\n\n## an entry\n');
  logLine(dir, '2026-09-11T09:00:00.000Z');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'work');
  receipt(dir);
  return dir;
}

const made: string[] = [];
const make = (f: () => string): string => {
  const d = f();
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('a branch that is ready', () => {
  it('passes, so every refusal below means something', () => {
    expect(run(make(readyBranch))).toMatchObject({ ok: true, refusals: [] });
  });
});

describe('the branch itself', () => {
  it('refuses main, because a pull request needs a branch of its own', () => {
    const dir = make(readyBranch);
    git(dir, 'checkout', '-q', 'main');
    expect(run(dir).refusals.join(' ')).toContain('branch of its own');
  });

  it('refuses a branch with no commits of its own', () => {
    const dir = make(repo);
    git(dir, 'checkout', '-qb', 'empty');
    receipt(dir);
    expect(run(dir).refusals.join(' ')).toContain('nothing to open a pull request about');
  });

  it('refuses uncommitted work, which a pull request cannot carry', () => {
    const dir = make(readyBranch);
    writeFileSync(path.join(dir, 'PROGRESS.md'), '# journal\n\n## edited after the commit\n');
    expect(run(dir).refusals.join(' ')).toContain('uncommitted changes');
  });
});

describe('the receipt, because CI recomputes it from a clean clone', () => {
  it('refuses when there is none', () => {
    const dir = make(readyBranch);
    rmSync(path.join(dir, '.generated', 'receipt.json'));
    expect(run(dir).refusals.join(' ')).toContain('no verify receipt');
  });

  it('refuses a red one, and names the verdict it found', () => {
    const dir = make(readyBranch);
    receipt(dir, 'fail');
    expect(run(dir).refusals.join(' ')).toContain('was fail, not pass');
  });

  it('refuses when the tree moved after the run', () => {
    const dir = make(readyBranch);
    writeFileSync(path.join(dir, 'PROGRESS.md'), '# journal\n\n## moved\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'after the receipt');
    expect(run(dir).refusals.join(' ')).toContain('tree changed after the last green run');
  });
});

describe('the order of runs, which used to be a refusal', () => {
  // Until 2026-09-12 the record was one append-only file, two branches that
  // both ran the gate conflicted at its end, and this guard refused a branch
  // whose newest run was older than main's so that the merge could resolve.
  // The record is a file per run now; the merge never conflicts and the
  // order of runs is nobody's business.
  it('says nothing when main recorded a newer run than the branch', () => {
    const dir = make(readyBranch);
    const branch = git(dir, 'branch', '--show-current');
    git(dir, 'checkout', '-q', 'main');
    logLine(dir, '2027-01-01T00:00:00.000Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'a later run on main');
    git(dir, 'checkout', '-q', branch);
    receipt(dir);
    const verdict = run(dir);
    expect(verdict.ok).toBe(true);
    expect(verdict.refusals.filter((r) => r.includes('older than'))).toEqual([]);
  });
});

describe('the journal', () => {
  it('refuses a branch that never touched PROGRESS.md', () => {
    const dir = make(repo);
    git(dir, 'checkout', '-qb', 'no-journal');
    writeFileSync(path.join(dir, 'other.txt'), 'work\n');
    logLine(dir, '2026-09-11T09:00:00.000Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'work with no entry');
    receipt(dir);
    expect(run(dir).refusals.join(' ')).toContain('no PROGRESS.md entry');
  });
});

describe('it reports everything wrong at once', () => {
  it('does not stop at the first refusal, so one run fixes one round', () => {
    const dir = make(repo);
    rmSync(path.join(dir, '.generated'), { recursive: true, force: true });
    writeFileSync(path.join(dir, 'dirty.txt'), 'x\n');
    const found = run(dir).refusals;
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.join(' ')).toContain('branch of its own');
    expect(found.join(' ')).toContain('uncommitted changes');
    expect(found.join(' ')).toContain('no verify receipt');
  });
});
