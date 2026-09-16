import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The design reviewer, and the two things that decide whether it runs: the
 * brief's UI line, and the walk under .generated/ui/. The reviewer itself is
 * a brief to a model and cannot be fired at here; what can be is that the
 * brief says the right thing, that review-pr dispatches on it, and that the
 * agent's text holds the one rule the harness needs from it — no walk, no
 * review.
 */
const REPO = path.resolve(__dirname, '..', '..');
const BRIEF = path.join(REPO, 'scripts', 'pr-review-brief.mjs');

function exported<T>(expression: string): T {
  const out = execFileSync('node', ['--input-type=module', '-e', `import * as m from ${JSON.stringify(BRIEF)}; console.log(JSON.stringify(${expression}));`], { cwd: REPO, encoding: 'utf8' });
  return JSON.parse(out) as T;
}

const base = {
  branch: 'b', base: 'origin/main', range: 'a..b', commits: [], files: [], entries: { opened: [], closed: [], retracted: [] },
  specs: [], evidence: null, surface: [], journal: false, tests: [], protectedFiles: [],
};

describe('the brief, on the UI', () => {
  it('counts the files under each configured UI prefix, and nothing under none', () => {
    expect(exported("m.uiTouched(['apps/web/src/A.tsx', 'apps/web/src/B.tsx', 'packages/core/x.ts'], ['apps/web/src/'])")).toEqual([{ path: 'apps/web/src/', files: 2 }]);
    expect(exported("m.uiTouched(['packages/core/x.ts'], ['apps/web/src/'])")).toEqual([]);
  });

  it('says the UI is unchanged, so no design review is required', () => {
    const text = exported<string>(`m.render(${JSON.stringify({ ...base, ui: [], walk: null })})`);
    expect(text).toContain('UI: unchanged, so no design review is required');
    expect(text).not.toContain('Walk:');
  });

  it('names the touched prefixes and the newest walk, when there is one', () => {
    const text = exported<string>(`m.render(${JSON.stringify({ ...base, ui: [{ path: 'apps/web/src/', files: 3 }], walk: { id: '20260916T140000Z', files: 4 } })})`);
    expect(text).toContain('UI touched: apps/web/src/ (3 file(s))');
    expect(text).toContain('Walk: .generated/ui/20260916T140000Z/ (4 file(s))');
  });

  it('says there is no walk to look at, when the UI changed and none was filed', () => {
    const text = exported<string>(`m.render(${JSON.stringify({ ...base, ui: [{ path: 'apps/web/src/', files: 1 }], walk: null })})`);
    expect(text).toContain('Walk: none under .generated/ui/ on this machine');
    expect(text).toContain('nothing to look at');
  });

  it('finds the newest walk folder by its id, counting what it holds', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'walk-'));
    try {
      mkdirSync(path.join(dir, '20260916T100000Z'));
      mkdirSync(path.join(dir, '20260916T120000Z', 'nested'), { recursive: true });
      writeFileSync(path.join(dir, '20260916T120000Z', 'home.png'), '');
      writeFileSync(path.join(dir, '20260916T120000Z', 'nested', 'home.snapshot.txt'), '');
      mkdirSync(path.join(dir, 'not-a-walk'));
      expect(exported(`m.newestWalk(${JSON.stringify(dir)})`)).toEqual({ id: '20260916T120000Z', files: 2 });
      expect(exported(`m.newestWalk(${JSON.stringify(path.join(dir, 'absent'))})`)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('this repository names its UI: the web template', () => {
    const config = JSON.parse(readFileSync(path.join(REPO, 'harness.config.json'), 'utf8')) as { ui: { paths: string[] } };
    expect(config.ui.paths).toEqual(['templates/web/']);
    // And the brief reads it: with the template prefix given as touched,
    // the line names it; on the real branch it says whichever is true.
    expect(exported("m.uiTouched(['templates/web/apps/web/src/Home.tsx'])")).toEqual([{ path: 'templates/web/', files: 1 }]);
    const out = execFileSync('node', [BRIEF], { cwd: REPO, encoding: 'utf8' });
    expect(out).toMatch(/^UI(: unchanged, so no design review is required| touched: templates\/web\/ \(\d+ file\(s\)\))$/mu);
  });
});

describe('the reviewer and the skill that dispatches it', () => {
  const agent = readFileSync(path.join(REPO, '.claude', 'agents', 'design-review.md'), 'utf8');
  const skill = readFileSync(path.join(REPO, '.claude', 'skills', 'review-pr', 'SKILL.md'), 'utf8');

  it('is an agent with the read-only tools, named design-review', () => {
    expect(agent).toMatch(/^---\nname: design-review\n/u);
    expect(agent).toContain('tools: Read, Grep, Glob');
  });

  it('holds the one rule: no walk, no review, and ends in one of three verdicts', () => {
    expect(agent).toContain('**No walk, no review.**');
    expect(agent).toContain('Do not review the screen from its code');
    for (const verdict of ['**HOLDS**', '**FINDINGS**', '**NO WALK**']) expect(agent).toContain(verdict);
  });

  it('asks a finding for a screenshot, a file and line, a rule and a consequence', () => {
    for (const field of ['`screenshot`', '`where`', '`rule`', '`consequence`']) expect(agent).toContain(field);
  });

  it('is the fifth reviewer in review-pr\'s table, dispatched when the brief says the UI changed', () => {
    expect(skill).toContain('Five, and each has a question the others do not:');
    const rows = skill.split('\n').filter((line) => /^\| [^|-]/u.test(line) && !line.startsWith('| Reviewer'));
    expect(rows).toHaveLength(5);
    expect(rows[3]).toContain('| `design-review` |');
    expect(skill).toContain('only when the brief says the UI changed');
    expect(skill).toContain('Skip `design-review` when the brief says the UI is unchanged');
    expect(skill).toContain('its NO WALK is the finding');
  });
});
