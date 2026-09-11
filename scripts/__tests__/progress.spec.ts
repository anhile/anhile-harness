/**
 * Fires at scripts/progress.mjs, and holds the real PROGRESS.md to its shape.
 *
 * The journal had reached 42 entries and 96 KB, twelve of them in a shape the
 * template had replaced, before anything checked it. `check` refuses an entry
 * without the six fields or with a date before its predecessor; `rotate` moves
 * the older entries into docs/history/ by month without changing a byte of
 * them. The last test runs `check` against this repository's own file, which
 * is the guard: a session that writes an entry in the wrong shape turns step 03
 * red before the commit.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

let dir: string;
const run = (...args: string[]) => {
  try {
    return { status: 0, out: execFileSync('node', [path.join(dir, 'scripts', 'progress.mjs'), ...args], { cwd: dir, encoding: 'utf8' }) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const entry = (date: string, title: string, over: Partial<Record<string, string>> = {}) => {
  const fields: Record<string, string> = {
    Feature: 'none closed', Result: 'passing', 'Verified by': '`./verify.sh` 9/9', Evidence: 'the log',
    'Contract changes': 'none', Notes: '', ...over,
  };
  const body = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `- **${k}**: ${v}`).join('\n');
  return `## ${date} — ${title}\n\n${body}\n\n  Some notes about ${title}.\n`;
};
const HEADER = '# Progress log\n\nOne entry per session.\n\n';
const write = (...entries: string[]) => writeFileSync(path.join(dir, 'PROGRESS.md'), HEADER + entries.join('\n'));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'progress-'));
  mkdirSync(path.join(dir, 'scripts'));
  // progress.mjs reads harness.config.json through the loader since 2026-09-11,
  // for the contracts package its template names. Without both, it throws
  // before doing anything, and every case here fails for that instead of its
  // own reason.
  copyFileSync(path.join(REPO, 'scripts', 'harness-config.mjs'), path.join(dir, 'scripts', 'harness-config.mjs'));
  copyFileSync(path.join(REPO, 'harness.config.json'), path.join(dir, 'harness.config.json'));
  copyFileSync(path.join(REPO, 'scripts', 'progress.mjs'), path.join(dir, 'scripts', 'progress.mjs'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('check', () => {
  it('accepts entries in the template shape, dated in order', () => {
    write(entry('2026-09-01', 'one'), entry('2026-09-02', 'two'), entry('2026-09-02', 'same day again'));
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('3 entries');
  });

  it('refuses a missing field, naming it and the entry, and prints the template', () => {
    write(entry('2026-09-01', 'one'), entry('2026-09-02', 'two', { 'Verified by': undefined as unknown as string }));
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('entry 2 (2026-09-02 — two): missing `- **Verified by**:`');
    expect(out).toContain('- **Contract changes**:');
  });

  it('refuses a heading that is not dated', () => {
    write(entry('2026-09-01', 'one'), '## Untitled thoughts\n\n- **Feature**: x\n');
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('heading is not `## YYYY-MM-DD — title`');
  });

  it('does not take a heading inside a fenced block for an entry: the header carries the template', () => {
    writeFileSync(path.join(dir, 'PROGRESS.md'),
      HEADER + 'Entry format:\n\n```markdown\n## 2026-01-01 — <title>\n\n- **Feature**: <x>\n```\n\n' + entry('2026-09-01', 'one'));
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('1 entries');
    expect(run('status').out).toContain('1 entries');
  });

  it('refuses dates going backwards: newest goes at the bottom', () => {
    write(entry('2026-09-05', 'later'), entry('2026-09-01', 'earlier'));
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('dated 2026-09-01, before the entry above it (2026-09-05)');
  });
});

describe('rotate', () => {
  const all = ['2026-07-30', '2026-08-01', '2026-08-15', '2026-09-01', '2026-09-02'].map((d, i) => entry(d, `entry ${i}`));

  it('moves everything but the newest N into the archive, by month, and keeps the header', () => {
    write(...all);
    const { status, out } = run('rotate', '--keep', '2');
    expect(status).toBe(0);
    expect(out).toContain('moved 3 entries');
    const live = readFileSync(path.join(dir, 'PROGRESS.md'), 'utf8');
    expect(live.startsWith(HEADER)).toBe(true);
    expect(live).toContain('## 2026-09-01 — entry 3');
    expect(live).toContain('## 2026-09-02 — entry 4');
    expect(live).not.toContain('entry 2');
    expect(existsSync(path.join(dir, 'docs', 'history', 'PROGRESS-2026-07.md'))).toBe(true);
    const aug = readFileSync(path.join(dir, 'docs', 'history', 'PROGRESS-2026-08.md'), 'utf8');
    expect(aug).toContain('## 2026-08-01 — entry 1');
    expect(aug).toContain('## 2026-08-15 — entry 2');
    expect(aug).toContain('only moved');
  });

  it('changes no byte of an entry: every original entry reads back from the archives and the live file', () => {
    write(...all);
    run('rotate', '--keep', '1');
    const archives = ['2026-07', '2026-08', '2026-09']
      .map((m) => readFileSync(path.join(dir, 'docs', 'history', `PROGRESS-${m}.md`), 'utf8'))
      .join('\n');
    const everything = `${archives}\n${readFileSync(path.join(dir, 'PROGRESS.md'), 'utf8')}`;
    for (const e of all) expect(everything).toContain(e.trim());
    // And nothing was duplicated: each heading appears exactly once across the files.
    for (const e of all) expect(everything.split(e.split('\n')[0] ?? e).length - 1).toBe(1);
  });

  it('appends to an archive that already exists rather than replacing it', () => {
    mkdirSync(path.join(dir, 'docs', 'history'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'history', 'PROGRESS-2026-08.md'), '# older archive\n\n---\n\n## 2026-08-00 — hand-moved\n');
    write(...all);
    run('rotate', '--keep', '2');
    const aug = readFileSync(path.join(dir, 'docs', 'history', 'PROGRESS-2026-08.md'), 'utf8');
    expect(aug.startsWith('# older archive')).toBe(true);
    expect(aug).toContain('hand-moved');
    expect(aug).toContain('entry 2');
  });

  it('is a no-op at or under the limit, and idempotent after', () => {
    write(...all);
    expect(run('rotate', '--keep', '5').out).toContain('nothing moved');
    run('rotate', '--keep', '2');
    expect(run('rotate', '--keep', '2').out).toContain('nothing moved');
  });

  it('status says how many are due', () => {
    write(...all);
    expect(run('status', '--keep', '2').out).toContain('3 older than the newest 2');
  });
});

describe('this repository', () => {
  it('PROGRESS.md is in the template shape, every entry', () => {
    const out = execFileSync('node', [path.join(REPO, 'scripts', 'progress.mjs'), 'check'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain("every one in the template's shape");
  });

  it('the stop hook prints the same template', () => {
    const stop = readFileSync(path.join(REPO, 'scripts', 'session-stop.mjs'), 'utf8');
    expect(stop).toContain("import { template } from './progress.mjs'");
    expect(stop).not.toContain('export function template');
  });
});
