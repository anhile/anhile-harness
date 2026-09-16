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
  // `check` follows an entry's Evidence into the two records, so it imports
  // their readers, and they import the receipt's.
  for (const f of ['verify-log.mjs', 'audit-log.mjs', 'verify-receipt.mjs']) {
    copyFileSync(path.join(REPO, 'scripts', f), path.join(dir, 'scripts', f));
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** A run on record, by id. */
function recordRun(id: string): void {
  mkdirSync(path.join(dir, 'verify-log'), { recursive: true });
  writeFileSync(path.join(dir, 'verify-log', `${id}.json`), `${JSON.stringify({ at: '2026-09-16T10:00:00.000Z', result: 'pass', tree: 'sha256:a', steps: {} })}\n`);
}

/** An audit on record, by id, with its verdict. */
function recordAudit(id: string, verdict: string): void {
  mkdirSync(path.join(dir, 'audit-log'), { recursive: true });
  writeFileSync(path.join(dir, 'audit-log', `${id}.json`), `${JSON.stringify({ spec: 'specs/x.md', verdict, at: '2026-09-16T10:00:00.000Z', treeHash: 'sha256:a' })}\n`);
}

/** A repository whose HEAD carries one entry from before the rule, in prose. */
function committedJournal(): void {
  write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  git('commit', '-qm', 'journal');
}

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

describe('the Evidence of a new entry points into the record', () => {
  // Until 2026-09-16 the field was prose — "the run recorded for this tree" —
  // which reads like a pointer and points at nothing. A reader, and CI, can
  // now follow it: a run id under verify-log/, and an audit id under
  // audit-log/ when the entry closed something. Only entries new since the
  // baseline are asked, so the journal's past stays as it was written.
  const RUN = '20260916T100000Z';
  const AUDIT = '20260916T100500.123Z';

  it('accepts a new entry naming a run on record, and leaves the old prose alone', () => {
    committedJournal();
    recordRun(RUN);
    write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }), entry('2026-09-16', 'the work', { Evidence: `verify-log/${RUN}` }));
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('1 new since HEAD, evidence on record');
  });

  it('refuses a new entry whose Evidence names no run', () => {
    committedJournal();
    write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }), entry('2026-09-16', 'the work', { Evidence: 'the run recorded for this tree' }));
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('entry 2 (2026-09-16 — the work): Evidence names no run');
  });

  it('refuses a run that is not on record', () => {
    committedJournal();
    write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }), entry('2026-09-16', 'the work', { Evidence: `verify-log/${RUN}` }));
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain(`Evidence names run ${RUN}, which is not under verify-log/`);
  });

  it('asks a closing entry for the audit that said READY', () => {
    committedJournal();
    recordRun(RUN);
    const closing = (evidence: string) =>
      entry('2026-09-16', 'closing', { Feature: 'closed #3 — "the thing"', Evidence: evidence });
    const before = entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' });
    write(before, closing(`verify-log/${RUN}`));
    expect(run('check').out).toContain('closes a feature and Evidence names no audit');
    write(before, closing(`verify-log/${RUN}; audit-log/${AUDIT}`));
    expect(run('check').out).toContain(`Evidence names audit ${AUDIT}, which is not under audit-log/`);
    recordAudit(AUDIT, 'NOT_READY');
    expect(run('check').out).toContain(`Evidence names audit ${AUDIT}, which said NOT_READY, not READY`);
    rmSync(path.join(dir, 'audit-log', `${AUDIT}.json`));
    recordAudit(AUDIT, 'READY');
    expect(run('check').status).toBe(0);
  });

  it('does not take "none closed" for a closure', () => {
    committedJournal();
    recordRun(RUN);
    write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }), entry('2026-09-16', 'the work', { Feature: 'none closed — #3 stays open', Evidence: `verify-log/${RUN}` }));
    expect(run('check').status).toBe(0);
  });

  it('asks only the shape when there is no baseline', () => {
    // A repository with no commit yet, or a first commit in CI's walk: nothing
    // to compare against, so the pointers are not asked and the report says so.
    write(entry('2026-09-16', 'the work', { Evidence: 'nothing yet' }));
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('no baseline at HEAD, evidence not asked');
  });

  it('reads the journal and the records at a commit with --at, the way CI walks', () => {
    committedJournal();
    write(entry('2026-09-01', 'before the rule', { Evidence: 'the run recorded for this tree' }), entry('2026-09-16', 'the work', { Evidence: `verify-log/${RUN}` }));
    git('add', '-A');
    git('commit', '-qm', 'an entry pointing at a run the commit does not carry');
    expect(run('check', '--at', 'HEAD', '--base', 'HEAD^').status).toBe(1);
    recordRun(RUN);
    git('add', '-A');
    git('commit', '-qm', 'the run it names');
    // Against its own parent the entry is old; against the first commit it is new and the run is there.
    expect(run('check', '--at', 'HEAD', '--base', 'HEAD^').status).toBe(0);
    const { status, out } = run('check', '--at', 'HEAD', '--base', 'HEAD~2');
    expect(status).toBe(0);
    expect(out).toContain('1 new since HEAD~2');
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
    // And the pointers of whatever this working tree added since HEAD were
    // followed: this is step 03 asking the entry a session is about to commit.
    expect(out).toMatch(/\d+ new since HEAD, evidence on record/u);
  });

  it('the stop hook prints the same template', () => {
    const stop = readFileSync(path.join(REPO, 'scripts', 'session-stop.mjs'), 'utf8');
    expect(stop).toContain("import { newSince, pointerProblems, recordAt, template } from './progress.mjs'");
    expect(stop).not.toContain('export function template');
  });
});
