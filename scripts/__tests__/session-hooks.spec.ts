/**
 * Fires at scripts/session-start.mjs and scripts/session-stop.mjs.
 *
 * Two rules in CLAUDE.md lived only as prose until 2026-09-08: begin with the
 * git log, the newest PROGRESS.md entries and one open feature entry; end with
 * an entry in PROGRESS.md. The first hook performs the ritual, the second
 * checks that committed work carries an entry — once, and only for commits.
 *
 * Both derive their root from their own location, so they are copied into a
 * throwaway git repository with a PROGRESS.md and a feature_list.json of this
 * test's making, and driven through stdin as Claude Code would.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function commit(message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(repo, rel), content);
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

// Every entry names the run the fixture's first commit carries, since
// 2026-09-16: the stop hook follows an entry's Evidence into the record.
const RUN = '20260916T100000Z';
const progressWith = (...entries: string[]) => `# Progress\n\n${entries.map((e) => `## ${e}\n\n- **Feature**: x\n- **Evidence**: verify-log/${RUN}\n`).join('\n')}`;
const features = (entries: Array<{ description: string; passes: boolean; retracted?: object }>) =>
  JSON.stringify(entries.map((e) => ({ category: 'platform', steps: ['s'], ...e })), null, 2);

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'session-hooks-'));
  mkdirSync(path.join(repo, 'scripts'));
  // A fixture running a `configured` script needs harness.config.json and the
  // loader beside it: without both the script throws before doing anything,
  // and every case fails for that rather than its own reason.
  // check-main.mjs since 2026-09-11: session-start reports whether main is
  // green, so the fixture needs it or the hook cannot load at all.
  for (const script of ['session-start.mjs', 'session-stop.mjs', 'progress.mjs', 'harness-config.mjs', 'check-main.mjs', 'verify-log.mjs', 'audit-log.mjs', 'verify-receipt.mjs']) {
    copyFileSync(path.join(REPO, 'scripts', script), path.join(repo, 'scripts', script));
  }
  copyFileSync(path.join(REPO, 'harness.config.json'), path.join(repo, 'harness.config.json'));
  git('init', '-q', '-b', 'main');
  mkdirSync(path.join(repo, 'verify-log'));
  commit('first', {
    [`verify-log/${RUN}.json`]: '{"at":"2026-09-16T10:00:00.000Z","result":"pass","tree":"sha256:a","steps":{}}\n',
    'PROGRESS.md': progressWith('2026-09-01 — the beginning'),
    'feature_list.json': features([
      { description: 'closed one', passes: true },
      { description: 'open one', passes: false },
      { description: 'retracted one', passes: true, retracted: { reason: 'r' } },
    ]),
  });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

type Result = { status: number; stdout: string; stderr: string };

function hook(script: string, payload: Record<string, unknown>, env?: NodeJS.ProcessEnv): Result {
  try {
    const stdout = execFileSync('node', [path.join(repo, 'scripts', script)], {
      cwd: repo,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

const start = (session = 's1', source = 'startup') =>
  hook('session-start.mjs', { hook_event_name: 'SessionStart', session_id: session, source });
const stop = (session = 's1', active = false, env?: NodeJS.ProcessEnv) =>
  hook('session-stop.mjs', { hook_event_name: 'Stop', session_id: session, stop_hook_active: active }, env);

describe('session-start performs the ritual', () => {
  it('prints the log, the newest PROGRESS entry and the open entries, and never blocks', () => {
    const { status, stdout } = start();
    expect(status).toBe(0);
    expect(stdout).toContain('first');
    expect(stdout).toContain('2026-09-01 — the beginning');
    expect(stdout).toContain('1 open entry');
    expect(stdout).toContain('#1 [platform] open one');
    expect(stdout).not.toContain('closed one');
    expect(stdout).not.toContain('retracted one');
  });

  it('says when nothing is open, rather than leaving the session to invent a task', () => {
    commit('close', { 'feature_list.json': features([{ description: 'closed one', passes: true }]) });
    expect(start().stdout).toContain('every entry is closed');
  });

  it('shows a dirty working tree as a person\'s work to leave alone', () => {
    writeFileSync(path.join(repo, 'scratch.txt'), 'x');
    expect(start().stdout).toContain('leave it alone');
  });

  it('records the starting HEAD for the stop hook', () => {
    start();
    const record = JSON.parse(readFileSync(path.join(repo, '.generated', 'sessions', 's1.json'), 'utf8'));
    expect(record.head).toBe(git('rev-parse', 'HEAD'));
    expect(record.reminded).toBe(false);
  });

  it('keeps the record across a resume or a compaction: same session', () => {
    start();
    const before = git('rev-parse', 'HEAD');
    commit('later', { 'x.txt': 'x' });
    start('s1', 'resume');
    start('s1', 'compact');
    const record = JSON.parse(readFileSync(path.join(repo, '.generated', 'sessions', 's1.json'), 'utf8'));
    expect(record.head).toBe(before);
  });

  it('survives malformed input', () => {
    const result = execFileSync('node', [path.join(repo, 'scripts', 'session-start.mjs')], {
      cwd: repo, input: 'not json', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toContain('Session start');
  });
});

describe('session-stop insists on the PROGRESS entry, for commits, once', () => {
  it('lets a session stop when nothing was committed', () => {
    start();
    writeFileSync(path.join(repo, 'wip.txt'), 'uncommitted is fine');
    expect(stop().status).toBe(0);
  });

  it('blocks once when commits landed and none touched PROGRESS.md, with the template', () => {
    start();
    commit('work', { 'a.txt': 'a' });
    commit('more', { 'b.txt': 'b' });
    const first = stop();
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('2 commit(s) landed');
    expect(first.stderr).toContain('none touched PROGRESS.md');
    expect(first.stderr).toContain('- **Verified by**:');
    expect(first.stderr).toContain('2026-09-01 — the beginning');
    // Reminded. A hook that blocks every stop is a hook that gets deleted.
    expect(stop().status).toBe(0);
  });

  it('lets the session stop when a commit touched PROGRESS.md', () => {
    start();
    commit('work', { 'a.txt': 'a' });
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    expect(stop().status).toBe(0);
  });

  it('blocks once when the entry this session wrote points at nothing on record', () => {
    // The entry exists, so the first reminder is satisfied; its Evidence says
    // "the log", which a reader cannot follow. Once, like the others.
    start();
    commit('work', { 'a.txt': 'a' });
    commit('journal', {
      'PROGRESS.md': `${progressWith('2026-09-01 — the beginning')}\n## 2026-09-08 — the work\n\n- **Feature**: none closed\n- **Evidence**: the log\n`,
    });
    const first = stop();
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('2026-09-08 — the work: Evidence names no run');
    expect(first.stderr).toContain('verify-log.mjs tail 3');
    expect(stop().status).toBe(0);
  });

  it('lets the session stop when the entry names a run on record, committed or not', () => {
    start();
    commit('work', { 'a.txt': 'a' });
    commit('journal', {
      'verify-log/20260916T100100Z.json': '{"at":"2026-09-16T10:01:00.000Z","result":"pass","tree":"sha256:b","steps":{}}\n',
      'PROGRESS.md': `${progressWith('2026-09-01 — the beginning')}\n## 2026-09-08 — the work\n\n- **Feature**: none closed\n- **Evidence**: verify-log/20260916T100100Z\n`,
    });
    expect(stop().status).toBe(0);
  });

  it('does not block a continuation that a stop hook already caused', () => {
    start();
    commit('work', { 'a.txt': 'a' });
    expect(stop('s1', true).status).toBe(0);
  });

  it('says nothing without a record from session-start', () => {
    commit('work', { 'a.txt': 'a' });
    expect(stop('never-started').status).toBe(0);
  });

  it('keeps sessions apart by id', () => {
    start('one');
    commit('work', { 'a.txt': 'a' });
    start('two');
    expect(stop('two').status).toBe(0);
    expect(stop('one').status).toBe(2);
  });

  it('survives malformed input', () => {
    const status = (() => {
      try {
        execFileSync('node', [path.join(repo, 'scripts', 'session-stop.mjs')], {
          cwd: repo, input: '{', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status;
      }
    })();
    expect(status).toBe(0);
  });
});

describe('both hooks are registered', () => {
  // Settings are read at session start, so the session that installs a hook
  // cannot watch it fire. What it can do is make removing the registration a
  // red step 03. The file is protected; a person applied the patch.
  const settings = JSON.parse(readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  const commandsOf = (event: string) =>
    (settings.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((h) => h.command));

  it('SessionStart runs session-start.mjs', () => {
    expect(commandsOf('SessionStart').some((c) => c.includes('scripts/session-start.mjs'))).toBe(true);
  });

  it('Stop runs session-stop.mjs', () => {
    expect(commandsOf('Stop').some((c) => c.includes('scripts/session-stop.mjs'))).toBe(true);
  });
});

describe('session-stop reminds once about commits not on origin/main', () => {
  function addOrigin(): void {
    const bare = mkdtempSync(path.join(tmpdir(), 'session-hooks-origin-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git('remote', 'add', 'origin', bare);
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
  }

  it('says nothing without an origin', () => {
    start();
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    expect(stop().status).toBe(0);
  });

  it('blocks once when commits are ahead of origin/main, after the journal is written', () => {
    addOrigin();
    start();
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    const first = stop();
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('1 commit(s) on this branch are not on origin/main');
    expect(first.stderr).toContain('git push');
    expect(stop().status).toBe(0);
  });

  it('the journal reminder comes first, the push reminder after it', () => {
    addOrigin();
    start();
    commit('work', { 'a.txt': 'a' });
    expect(stop().stderr).toContain('none touched PROGRESS.md');
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    expect(stop().stderr).toContain('not on origin/main');
    expect(stop().status).toBe(0);
  });

  it('lets the session stop once the commits are pushed', () => {
    addOrigin();
    start();
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
    expect(stop().status).toBe(0);
  });
});

describe('session-stop asks whether CI has seen the commits, not whether they are on main', () => {
  /**
   * Until 2026-09-11 those were the same question, because every commit went
   * straight to main. The first pull request this repository ever opened was
   * stopped by this hook for being on a branch — the exact thing the pull
   * request existed to make possible.
   *
   * The workflow triggers on a push to main and on a pull request. A branch
   * that is only pushed triggers neither, so "pushed" alone is not the answer
   * either; a pull request has to be carrying it.
   */
  function origin(): void {
    const bare = mkdtempSync(path.join(tmpdir(), 'session-hooks-origin-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git('remote', 'add', 'origin', bare);
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
  }

  /** A `gh` that answers however the case needs, ahead of any real one. */
  function fakeGh(body: string): NodeJS.ProcessEnv {
    const bin = mkdtempSync(path.join(tmpdir(), 'session-hooks-bin-'));
    writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return { PATH: `${bin}:${process.env.PATH ?? ''}` };
  }

  function branchWithJournal(): void {
    origin();
    start();
    git('checkout', '-qb', 'some-work');
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
  }

  it('blocks a branch that was never pushed, and says to push it', () => {
    branchWithJournal();
    const first = stop();
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('git push');
    expect(first.stderr).not.toContain('/open-pr');
  });

  it('lets the session stop when an open pull request carries the branch', () => {
    branchWithJournal();
    git('push', '-q', 'origin', 'some-work');
    git('fetch', '-q', 'origin');
    expect(stop('s1', false, fakeGh('echo \'{"state":"OPEN","number":10}\'')).status).toBe(0);
  });

  it('blocks a pushed branch no pull request carries, and asks for one', () => {
    branchWithJournal();
    git('push', '-q', 'origin', 'some-work');
    git('fetch', '-q', 'origin');
    const first = stop('s1', false, fakeGh('echo \'{"state":"MERGED","number":9}\''));
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('/open-pr');
    expect(first.stderr).toContain('no open pull request carries it');
  });

  it('says why a pushed branch with no pull request is not enough', () => {
    branchWithJournal();
    git('push', '-q', 'origin', 'some-work');
    git('fetch', '-q', 'origin');
    const first = stop('s1', false, fakeGh('echo \'{"state":"CLOSED","number":9}\''));
    expect(first.stderr).toContain('only pushed triggers neither');
  });

  it('stays quiet when gh cannot answer, rather than blocking on what it cannot check', () => {
    branchWithJournal();
    git('push', '-q', 'origin', 'some-work');
    git('fetch', '-q', 'origin');
    expect(stop('s1', false, fakeGh('exit 1')).status).toBe(0);
  });

  it('blocks a branch pushed and then committed over, since that head is not on origin', () => {
    branchWithJournal();
    git('push', '-q', 'origin', 'some-work');
    git('fetch', '-q', 'origin');
    commit('more work after the push', { 'a.txt': 'a' });
    const first = stop('s1', false, fakeGh('echo \'{"state":"OPEN","number":10}\''));
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('git push');
  });

  it('still blocks unpushed commits on main, which it has always been right about', () => {
    origin();
    start();
    commit('journal', { 'PROGRESS.md': progressWith('2026-09-01 — the beginning', '2026-09-08 — the work') });
    expect(stop('s1', false, fakeGh('echo \'{"state":"OPEN","number":10}\'')).status).toBe(2);
  });
});
