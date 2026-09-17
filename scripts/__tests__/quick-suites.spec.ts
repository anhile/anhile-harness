/**
 * Which suites a quick run runs: by import, the suite itself, by name. The
 * rule is pure and fired at directly; the repository half runs the shipped
 * command in a throwaway repository with jest shimmed to answer nothing, so
 * what is asserted is the selection this module makes, not jest's.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'quick-suites.mjs');

type Selection = { selected: string[]; byImport: string[]; itself: string[]; byName: Record<string, string[]> };

/** The pure rule, through node: the module is ESM and the suite is not. */
function select(input: { changed: string[]; suites: string[]; related: string[]; texts: Record<string, string> }): Selection {
  // Through the environment, not argv: the module's own guard resolves argv[1] as a path.
  const out = execFileSync('node', ['--input-type=module', '-e', `
    import { selectSuites } from '${SCRIPT}';
    const input = JSON.parse(process.env.INPUT ?? '{}');
    const s = selectSuites({ ...input, textOf: (suite) => input.texts[suite] ?? '' });
    console.log(JSON.stringify({ ...s, byName: Object.fromEntries(s.byName) }));
  `], { encoding: 'utf8', env: { ...process.env, INPUT: JSON.stringify(input) } });
  return JSON.parse(out) as Selection;
}

describe('selectSuites', () => {
  const suites = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts', 'e.spec.ts'];
  const texts = {
    'a.spec.ts': "import { x } from '../src/x';",
    'b.spec.ts': "copyFileSync(path.join(REPO, 'scripts', 'verify-receipt.mjs'), ...)",
    'c.spec.ts': "readFileSync(path.join(REPO, 'harness.manifest.json'))",
    'd.spec.ts': 'nothing named here',
    'e.spec.ts': 'this one changed',
  };

  it('takes a suite by import, a suite that changed itself, a suite that names a changed path, one that names its basename, and leaves the rest', () => {
    const s = select({
      changed: ['src/x.ts', 'scripts/verify-receipt.mjs', 'harness.manifest.json', 'e.spec.ts'],
      suites,
      related: ['a.spec.ts', 'not-a-suite.ts'],
      texts,
    });
    expect(s.byImport).toEqual(['a.spec.ts']);
    expect(s.itself).toEqual(['e.spec.ts']);
    expect(s.byName).toEqual({ 'b.spec.ts': ['scripts/verify-receipt.mjs'], 'c.spec.ts': ['harness.manifest.json'] });
    expect(s.selected).toEqual(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'e.spec.ts']);
  });

  it('selects nothing when nothing changed, and does not count a changed suite by name too', () => {
    expect(select({ changed: [], suites, related: [], texts }).selected).toEqual([]);
    const s = select({ changed: ['b.spec.ts'], suites, related: [], texts: { ...texts, 'a.spec.ts': "the file b.spec.ts" } });
    expect(s.itself).toEqual(['b.spec.ts']);
    expect(s.byName).toEqual({ 'a.spec.ts': ['b.spec.ts'] });
    expect(s.selected).toEqual(['a.spec.ts', 'b.spec.ts']);
  });
});

describe('describe', () => {
  it('says the counts and what each suite named', () => {
    const out = execFileSync('node', ['--input-type=module', '-e', `
      import { describe } from '${SCRIPT}';
      console.log(describe({ selected: ['a', 'b', 'c'], byImport: ['a'], itself: ['c'], byName: new Map([['b', ['x.mjs', 'y.json']]]) }, { base: 'main', total: 9 }));
      console.log(describe({ selected: [], byImport: [], itself: [], byName: new Map() }, { base: 'main', total: 9 }));
    `], { encoding: 'utf8' });
    expect(out).toContain('quick-suites: 3 of 9 suite(s) since main — 1 by import, 1 changed themselves, 1 by name');
    expect(out).toContain('  by name: b ← x.mjs, y.json');
    expect(out).toContain('quick-suites: 0 of 9 suite(s) since main — 0 by import, 0 changed themselves, 0 by name');
    expect(out).toContain('  nothing changed since main that any suite imports, is, or names');
  });
});

describe('in a repository', () => {
  let repo: string;
  let shims: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), text);
  };
  const run = (...args: string[]) => {
    const result = spawnSync('node', [path.join(repo, 'scripts', 'quick-suites.mjs'), ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    return { status: result.status ?? -1, out: result.stdout, why: result.stderr };
  };
  const exported = (expr: string) =>
    JSON.parse(execFileSync('node', ['--input-type=module', '-e', `import * as m from '${path.join(repo, 'scripts', 'quick-suites.mjs')}'; console.log(JSON.stringify(${expr}))`], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}` } })) as string[];

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'quick-suites-')));
    mkdirSync(path.join(repo, 'scripts'));
    copyFileSync(SCRIPT, path.join(repo, 'scripts', 'quick-suites.mjs'));
    // jest answers nothing here: the import graph is jest's, the rest is ours.
    shims = path.join(repo, 'shims');
    mkdirSync(shims);
    // jest answers `--listTests` from JEST_LIST when set, nothing otherwise, and refuses under JEST_FAIL.
    writeFileSync(
      path.join(shims, 'pnpm'),
      '#!/bin/sh\n[ -n "$JEST_FAIL" ] && exit 1\ncase "$*" in *--listTests*) [ -n "$JEST_LIST" ] && printf \'%s\\n\' $JEST_LIST ;; esac\nexit 0\n',
    );
    chmodSync(path.join(shims, 'pnpm'), 0o755);
    write('.gitignore', 'shims/\nignored.spec.ts\n');
    write('scripts/spike.mjs', 'export const a = 1;\n');
    write('scripts/other.mjs', 'export const b = 2;\n');
    write('scripts/__tests__/spike.spec.ts', "copyFileSync(path.join(REPO, 'scripts', 'spike.mjs'), ...);\n");
    write('scripts/__tests__/other.spec.ts', "// names nothing that changes\n");
    write('README.md', '# x\n');
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'work');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('changedSince lists the four kinds of change once each', () => {
    write('README.md', '# x\n\ncommitted on the branch\n');
    git('add', '-A');
    git('commit', '-qm', 'on the branch');
    write('scripts/spike.mjs', 'export const a = 2;\n'); // unstaged
    write('staged.txt', 'staged\n');
    git('add', 'staged.txt');
    write('untracked.txt', 'untracked\n');
    write('ignored.spec.ts', 'ignored\n');
    expect(exported("m.changedSince('main', process.cwd())")).toEqual(['README.md', 'scripts/spike.mjs', 'staged.txt', 'untracked.txt']);
  });

  it('allSuites lists the spec files, tracked or not, and nothing else, when jest answers nothing', () => {
    write('scripts/__tests__/new.spec.ts', 'untracked suite\n');
    write('ignored.spec.ts', 'ignored\n');
    expect(exported('m.allSuites(process.cwd())')).toEqual(['scripts/__tests__/new.spec.ts', 'scripts/__tests__/other.spec.ts', 'scripts/__tests__/spike.spec.ts']);
  });

  it('allSuites takes jest\'s list when it gives one, and relatedByImport is empty when jest refuses', () => {
    write('scripts/__tests__/new.spec.ts', 'on disk, and not in the list\n');
    const list = ['scripts/__tests__/spike.spec.ts', 'scripts/__tests__/other.spec.ts'].map((rel) => path.join(repo, rel)).join(' ');
    const listed = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `import * as m from '${path.join(repo, 'scripts', 'quick-suites.mjs')}'; console.log(JSON.stringify([m.allSuites(process.cwd()), m.relatedByImport('main', process.cwd())]))`], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}`, JEST_LIST: list },
    })) as [string[], string[]];
    // What jest lists, sorted and relative; the suite on disk that jest does not list is not a suite here.
    expect(listed[0]).toEqual(['scripts/__tests__/other.spec.ts', 'scripts/__tests__/spike.spec.ts']);
    // The same shim answered --listTests --changedSince too: by import, then, both.
    expect(listed[1]).toEqual(['scripts/__tests__/spike.spec.ts', 'scripts/__tests__/other.spec.ts']);
    const refused = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `import * as m from '${path.join(repo, 'scripts', 'quick-suites.mjs')}'; console.log(JSON.stringify([m.allSuites(process.cwd()), m.relatedByImport('main', process.cwd())]))`], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}`, JEST_FAIL: '1' },
    })) as [string[], string[]];
    expect(refused[0]).toEqual(['scripts/__tests__/new.spec.ts', 'scripts/__tests__/other.spec.ts', 'scripts/__tests__/spike.spec.ts']);
    expect(refused[1]).toEqual([]);
  });

  it('the command prints the suite that names the changed script and says why, and nothing when nothing changed', () => {
    const quiet = run('--base', 'main');
    expect(quiet.status).toBe(0);
    expect(quiet.out).toBe('');
    expect(quiet.why).toContain('quick-suites: 0 of 2 suite(s) since main — 0 by import, 0 changed themselves, 0 by name');
    expect(quiet.why).toContain('nothing changed since main that any suite imports, is, or names');

    write('scripts/spike.mjs', 'export const a = 2;\n');
    const named = run('--base', 'main');
    expect(named.status).toBe(0);
    expect(named.out).toBe('scripts/__tests__/spike.spec.ts\n');
    expect(named.why).toContain('quick-suites: 1 of 2 suite(s) since main — 0 by import, 0 changed themselves, 1 by name');
    expect(named.why).toContain('  by name: scripts/__tests__/spike.spec.ts ← scripts/spike.mjs');
  });

  it('travels in the manifest\'s core, and I11 names the three grounds', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'harness.manifest.json'), 'utf8')) as { core: { scripts: string[] } };
    expect(manifest.core.scripts).toContain('scripts/quick-suites.mjs');
    const invariants = readFileSync(path.join(REPO, 'docs', 'INVARIANTS.md'), 'utf8');
    expect(invariants).toContain('`scripts/quick-suites.mjs` picks the suites on three grounds');
    expect(invariants).toContain('by import, jest\'s own answer');
    expect(invariants).toContain('a suite that reaches a file by a path it computes');
  });
});
