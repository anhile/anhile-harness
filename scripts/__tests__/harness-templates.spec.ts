import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The application sources a generated project starts from live under
 * `templates/`, as real files at the path they take in the project, and
 * `harness-templates.mjs` says which travel and puts the project's name in.
 *
 * Until 0.1.3 every one of them was an array of quoted lines in that module:
 * four hundred strings no editor highlighted, eslint never read, and a diff
 * showed as a changed string. The review of 0.1.0 wrote it down as a debt;
 * this suite is what paying it holds still. Nothing here asserts what a
 * template *says* — that is `harness-init.spec.ts` and the generate job,
 * which installs and gates what was written.
 */
const REPO = path.resolve(__dirname, '..', '..');
const TEMPLATES = path.join(REPO, 'templates');
const TOKEN = '__PROJECT_NAME__';

/** Every file under a directory, relative to it, in a stable order. */
function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const abs = path.join(dir, entry);
      const rel = prefix === '' ? entry : `${prefix}/${entry}`;
      return statSync(abs).isDirectory() ? walk(abs, rel) : [rel];
    });
}

/** What the module exports, read through node since ts-jest cannot import ESM. */
function exported(): { api: string[]; web: string[]; fromDisk: string[] } {
  const out = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      [
        "import { API, WEB } from './scripts/harness-templates.mjs';",
        "import { readFileSync } from 'node:fs';",
        // Which entries are read from disk is a fact about the module's text,
        // not something its exports say; the source names each one.
        "const src = readFileSync('scripts/harness-templates.mjs', 'utf8');",
        "const fromDisk = [...src.matchAll(/fromFile\\('(api|web)', '([^']+)'\\)/gu)].map((m) => `${m[1]}/${m[2]}`);",
        'console.log(JSON.stringify({ api: Object.keys(API), web: Object.keys(WEB), fromDisk }));',
      ].join('\n'),
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  return JSON.parse(out) as { api: string[]; web: string[]; fromDisk: string[] };
}

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function scaffold(extra: string[]): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'harness-templates-')), 'probe');
  made.push(path.dirname(dir));
  execFileSync('node', [path.join(REPO, 'scripts', 'harness-init.mjs'), '--yes', '--name', 'probe', '--into', dir, ...extra], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return dir;
}

describe('the files under templates/ and the module agree', () => {
  const files = walk(TEMPLATES);
  const { api, web, fromDisk } = exported();

  it('there are files, in the two variants the generator knows', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(new Set(files.map((f) => f.split('/')[0]))).toEqual(new Set(['api', 'web']));
  });

  it('every file on disk is one the module writes, at the same path in the project', () => {
    // A file here that nothing writes is a file somebody will edit and
    // wonder why the change never reaches a project.
    const known = new Set(fromDisk);
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });

  it('every entry the module reads from disk is there', () => {
    const present = new Set(files);
    expect(fromDisk.filter((f) => !present.has(f))).toEqual([]);
  });

  it('each variant reads only its own directory', () => {
    for (const rel of fromDisk) {
      const [variant, ...rest] = rel.split('/');
      const target = rest.join('/');
      expect({ rel, listed: (variant === 'api' ? api : web).includes(target) }).toEqual({ rel, listed: true });
    }
  });

  it('the JSON ones are still built, because a comment in a `//` key is worth less than one in code', () => {
    // package.json and the tsconfigs carry the reasons for their settings as
    // comments beside the setting. A file would have to smuggle those into
    // `//` keys; the module keeps them where a reader of the module sees them.
    for (const rel of ['apps/api/package.json', 'apps/api/tsconfig.json', 'tsconfig.functions.json', 'apps/web/package.json']) {
      expect(existsSync(path.join(TEMPLATES, 'api', rel)) || existsSync(path.join(TEMPLATES, 'web', rel))).toBe(false);
    }
    expect(api).toContain('apps/api/package.json');
    expect(web).toContain('apps/web/package.json');
  });
});

describe('the one token a template carries', () => {
  it('is the project name, and no file carries any other placeholder shape', () => {
    // One token, one spelling. A second convention — `{{name}}`, `$NAME` —
    // would be replaced by nothing and reach a project as text.
    for (const rel of walk(TEMPLATES)) {
      const text = readFileSync(path.join(TEMPLATES, rel), 'utf8');
      expect({ rel, other: /\{\{\s*\w+\s*\}\}|__[A-Z_]+__/gu.test(text.replaceAll(TOKEN, '')) }).toEqual({ rel, other: false });
    }
  });

  it('is carried by the files that show the name, and by no other', () => {
    const carrying = walk(TEMPLATES).filter((rel) => readFileSync(path.join(TEMPLATES, rel), 'utf8').includes(TOKEN));
    expect(carrying).toEqual([
      'api/apps/api/src/main.ts',
      'web/apps/web/DESIGN.md',
      'web/apps/web/index.html',
      'web/apps/web/src/Home.spec.tsx',
      'web/apps/web/src/Home.tsx',
    ]);
  });

  it('is gone from a written project, with the name in its place', () => {
    const dir = scaffold(['--api', '--web']);
    // The module that names the token travels as a core script, so it is the
    // one file in a project that may say `__PROJECT_NAME__`; nothing written
    // from a template may.
    const left = walk(dir).filter(
      (rel) => rel !== 'scripts/harness-templates.mjs' && readFileSync(path.join(dir, rel), 'utf8').includes(TOKEN),
    );
    expect(left).toEqual([]);
    expect(readFileSync(path.join(dir, 'apps/web/index.html'), 'utf8')).toContain('<title>probe</title>');
    expect(readFileSync(path.join(dir, 'apps/web/src/Home.spec.tsx'), 'utf8')).toContain("name: 'probe'");
  });
});

describe('a template that is not there', () => {
  it('is refused by path, rather than written as a hole', () => {
    // The generator writes into somebody's new repository; a missing file
    // must be named before anything is written, not found by the gate later.
    let message = '';
    try {
      execFileSync(
        'node',
        [
          '--input-type=module',
          '-e',
          "import { fromFile } from './scripts/harness-templates.mjs'; fromFile('api', 'apps/api/src/not-there.ts')('probe');",
        ],
        { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      message = (error as { stderr: string }).stderr;
    }
    expect(message).toContain('template missing: templates/api/apps/api/src/not-there.ts');
  });
});

describe('what the web template imports', () => {
  it('is in the manifest under dependencies.apps.web, every bare package, so a project can install it', () => {
    // A template that imports a package the manifest does not name is a
    // project that fails at install, and the first place that would say so
    // is CI. This reads the sources and asks the manifest first.
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'harness.manifest.json'), 'utf8')) as { dependencies: { apps: { web: string[] } } };
    const shipped = new Set(manifest.dependencies.apps.web);
    const sources = walk(TEMPLATES).filter((rel) => rel.startsWith('web/') && /\.(ts|tsx|css)$/u.test(rel));
    const imported = new Set<string>();
    for (const rel of sources) {
      const text = readFileSync(path.join(TEMPLATES, rel), 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\s+|@import\s+)['"]([^'"]+)['"]/gu)) {
        const spec = m[1] ?? '';
        if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('/')) continue;
        const parts = spec.split('/');
        imported.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0] ?? spec);
      }
    }
    expect(imported.size).toBeGreaterThan(5);
    expect([...imported].filter((name) => !shipped.has(name)).sort()).toEqual([]);
  });
});
