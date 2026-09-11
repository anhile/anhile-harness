import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The boundary between the harness and the product it happens to guard.
 *
 * Written before any attempt to extract a reusable template, because a
 * generator built without this would copy files by guesswork and nobody would
 * notice which ones were wrong — the failure would arrive in somebody else's
 * repository, months later, as a guard that quietly checks nothing.
 *
 * Two properties, and the second is the one that rots:
 *
 *   every script and suite on disk is classified, in exactly one tier
 *   every `core` file names nothing about this product
 *
 * The first keeps the manifest complete as files are added. The second keeps
 * `core` honest: it is very easy to write a general-looking guard that reaches
 * for `apps/api` once, and after that it is no longer general.
 */
const REPO = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), 'utf8');

type Manifest = {
  core: { scripts: string[]; suites: string[] };
  dependencies: {
    scripts: Record<string, string[] | string>;
    toolchain: { packages: string[] };
    onlyWith: Record<string, string[] | string>;
  };
  configured: { scripts: Record<string, string[]>; suites: Record<string, string[]> };
  product: { scripts: string[]; suites: string[] };
  elsewhere: { core: string[]; seeded: string[]; product: string[] };
};

const manifest = JSON.parse(read('harness.manifest.json')) as Manifest;

const tierOf = (file: string): string[] =>
  [
    manifest.core.scripts.includes(file) || manifest.core.suites.includes(file) ? 'core' : '',
    file in manifest.configured.scripts || file in manifest.configured.suites ? 'configured' : '',
    manifest.product.scripts.includes(file) || manifest.product.suites.includes(file) ? 'product' : '',
  ].filter(Boolean);

const onDisk = {
  scripts: readdirSync(path.join(REPO, 'scripts'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `scripts/${f}`),
  suites: readdirSync(path.join(REPO, 'scripts', '__tests__'))
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => `scripts/__tests__/${f}`),
};

describe('every file is classified, in exactly one tier', () => {
  it('there is something to classify, so this does not pass by finding nothing', () => {
    // The floors are this repository's: twenty-five scripts and seventeen
    // suites came across from link-shortener, and a count under these means
    // a directory was not read rather than that something was deleted.
    expect(onDisk.scripts.length).toBeGreaterThan(15);
    expect(onDisk.suites.length).toBeGreaterThan(10);
  });

  it.each([...onDisk.scripts, ...onDisk.suites])('%s belongs to exactly one tier', (file) => {
    expect(tierOf(file)).toHaveLength(1);
  });

  it('names no file that is not there', () => {
    const named = [
      ...manifest.core.scripts,
      ...manifest.core.suites,
      ...Object.keys(manifest.configured.scripts),
      ...Object.keys(manifest.configured.suites),
      ...manifest.product.scripts,
      ...manifest.product.suites,
      ...manifest.elsewhere.core,
      ...manifest.elsewhere.seeded,
      ...manifest.elsewhere.product,
    ];
    expect(named.filter((f) => !existsSync(path.join(REPO, f)))).toEqual([]);
  });

  it('this suite classifies itself, which is the case most likely to be forgotten', () => {
    expect(tierOf('scripts/__tests__/harness-boundary.spec.ts')).toHaveLength(1);
  });
});

describe('core names nothing about this product', () => {
  /**
   * Identifiers that make a file this repository's rather than anyone's. A
   * `core` file mentioning one of these is a file that would be copied into
   * another project and be subtly wrong there.
   */
  const PRODUCT_WORDS = [
    'shortener',
    'anhile-links',
    'link.anhile',
    'apps/api',
    'apps/web',
    'packages/contracts',
    'packages/ui',
    'short code',
    'click_events',
  ];

  /**
   * Comments are stripped first, as they are in harness-config.spec.ts.
   * `check-feature-list.mjs` names two repositories in prose — this code was
   * written in `anhile/link-shortener` and moved, and the exemption it explains
   * is inert because of that move. Prose about history couples nothing; it
   * travels to another project as a confusing paragraph rather than as a wrong
   * path, and deleting it here would lose something true.
   */
  const codeOf = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

  /**
   * Two files in `core` write a layout rather than read one, and for them
   * `apps/api` is not a coupling — it is the directory they create in somebody
   * else's repository. Every other word still applies to them: a generator that
   * says `packages/contracts` or `shortener` is this product's generator.
   *
   * The exemption is two files and two words, and both halves are asserted
   * below, because an exemption nobody bounds is how a rule stops meaning
   * anything.
   */
  const LAYOUT_AUTHORS = ['scripts/harness-init.mjs', 'scripts/harness-templates.mjs'];
  const AUTHORED = ['apps/api', 'apps/web'];

  it.each(manifest.core.scripts)('%s is free of product identifiers', (file) => {
    const forbidden = LAYOUT_AUTHORS.includes(file)
      ? PRODUCT_WORDS.filter((w) => !AUTHORED.includes(w))
      : PRODUCT_WORDS;
    const code = codeOf(read(file));
    expect(forbidden.filter((w) => code.toLowerCase().includes(w.toLowerCase()))).toEqual([]);
  });

  it('exempts two files and two words, and the exempted files are real', () => {
    expect(AUTHORED).toHaveLength(2);
    for (const file of LAYOUT_AUTHORS) expect(manifest.core.scripts).toContain(file);
    // What is left after the exemption is still most of the list, or the
    // generators would be exempt from the rule rather than from part of it.
    expect(PRODUCT_WORDS.filter((w) => !AUTHORED.includes(w)).length).toBeGreaterThan(5);
  });

  it('exempts them only for directories they write, proved against what they write', () => {
    // The exemption stands on a fact rather than on a preference: these are the
    // paths the templates create. If the generator stopped writing them, the
    // exemption would be covering nothing and this case would say so.
    const templates = read('scripts/harness-templates.mjs');
    for (const dir of AUTHORED) expect(templates).toContain(`'${dir}/package.json'`);
  });

  it('the word list is not empty, or every case above passes for free', () => {
    expect(PRODUCT_WORDS.length).toBeGreaterThan(5);
  });

  it('the list catches what it is for, in code rather than in a comment', () => {
    // Without this the cases above could pass by stripping everything that
    // would have matched. In link-shortener the proof was coverage-floor.json,
    // whose areas were product paths; here the floor names `./packages/` and
    // nothing else. The manifest's `product` tier says in prose what that
    // product was, in a JSON string nothing strips, so the word list is proved
    // live against it.
    const prose = read('harness.manifest.json');
    expect(PRODUCT_WORDS.some((w) => prose.includes(w))).toBe(true);
  });

  it('the stripper removes comments and nothing else', () => {
    const sample = ['// apps/api in a line comment', '/* apps/web in a block */', "const kept = 'apps/api';"].join('\n');
    expect(codeOf(sample)).not.toContain('line comment');
    expect(codeOf(sample)).toContain("const kept = 'apps/api'");
  });
});

describe('configured says what has to move, not merely that something does', () => {
  const entries = [
    ...Object.entries(manifest.configured.scripts),
    ...Object.entries(manifest.configured.suites),
  ];

  it('there are entries to check', () => {
    // Seven scripts read harness.config.json; the suites that did in
    // link-shortener did not travel. Under this and a directory was not read.
    expect(entries.length).toBeGreaterThan(5);
  });

  it.each(entries)('%s names what it carries', (_file, reasons) => {
    expect(Array.isArray(reasons)).toBe(true);
    expect((reasons as string[]).length).toBeGreaterThan(0);
    for (const reason of reasons as string[]) expect(reason.length).toBeGreaterThan(8);
  });
});

describe('the protected files are core, because a template ships copies of them', () => {
  // A template cannot import them: the commit gate hashes these files and the
  // witness job runs them in place, so an import would be a file the guard
  // cannot see.
  const PROTECTED = [
    'verify.sh',
    '.github/workflows/verify.yml',
    '.claude/settings.json',
    'scripts/check-commit-gate.mjs',
    'scripts/check-protected-files.mjs',
    'scripts/verify-receipt.mjs',
    'scripts/audit-receipt.mjs',
  ];

  it.each(PROTECTED)('%s is in core, in one half of the manifest or the other', (file) => {
    const inScripts = manifest.core.scripts.includes(file);
    const inElsewhere = manifest.elsewhere.core.includes(file);
    expect(inScripts || inElsewhere).toBe(true);
  });

  it('the list matches the guard, so the two cannot drift apart', () => {
    const guard = read('scripts/check-protected-files.mjs');
    for (const file of PROTECTED) expect(guard).toContain(file);
  });
});

describe('dependencies: what the copied scripts need from npm', () => {
  /**
   * The manifest recorded files and not what they need until 2026-09-11, and
   * the generated project could not run `inbox.mjs` for it. Recording them is
   * only worth doing if the record cannot fall behind the imports, which is
   * what the two directions below are for.
   *
   * A real import is unindented and at the top of a file. The indented ones
   * are inside generated strings — `harness-init.mjs` writes an eslint config
   * that imports `typescript-eslint`, and that is the *new* project's
   * dependency rather than this script's.
   */
  const declared = manifest.dependencies.scripts;

  const importsOf = (file: string): string[] =>
    [...read(file).matchAll(/^import[^']*'([^']+)'/gmu)]
      .flatMap((m) => (m[1] === undefined ? [] : [m[1]]))
      .filter((name) => !name.startsWith('node:') && !name.startsWith('.'));

  const copied = [...manifest.core.scripts, ...Object.keys(manifest.configured.scripts)];

  it('there are scripts to check', () => {
    expect(copied.length).toBeGreaterThan(15);
  });

  it.each(copied)('%s imports nothing the manifest has not recorded', (file) => {
    const recorded = new Set(declared[file] ?? []);
    expect(importsOf(file).filter((name) => !recorded.has(name))).toEqual([]);
  });

  it('records nothing a script does not import', () => {
    const wrong: string[] = [];
    for (const [file, packages] of Object.entries(declared)) {
      if (file === '//') continue;
      const imported = new Set(importsOf(file));
      for (const p of packages as string[]) {
        // A @types/x package is never imported; it is there for the compiler.
        if (!p.startsWith('@types/') && !imported.has(p)) wrong.push(`${file} -> ${p}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('catches a missing record, proved against a script that really imports one', () => {
    // Without this the case above would pass for a set of scripts that import
    // nothing at all, which is how an assertion quietly stops meaning anything.
    expect(importsOf('scripts/inbox.mjs')).toContain('js-yaml');
  });

  it('does not mistake a generated import for one of its own', () => {
    // harness-init.mjs writes an eslint config that imports typescript-eslint.
    // That is the new project's dependency, and the scanner must not read the
    // string as an import by the generator.
    expect(read('scripts/harness-init.mjs')).toContain("import tseslint from 'typescript-eslint'");
    expect(importsOf('scripts/harness-init.mjs')).toEqual([]);
  });

  it('names only packages package.json or harness.versions.json can give a version for', () => {
    // Versions live in package.json, or — for what this repository does not
    // itself use — in harness.versions.json, and nowhere else. The first
    // generator hardcoded js-yaml ^4 while this repository had ^5, so a new
    // project would have got a different major of the library the script was
    // written against. harness-package.spec.ts holds the two files apart.
    const mine = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const recorded = JSON.parse(read('harness.versions.json')) as { versions: Record<string, string> };
    const available = { ...mine.dependencies, ...mine.devDependencies, ...recorded.versions };
    const named = [
      ...manifest.dependencies.toolchain.packages,
      ...Object.entries(declared).filter(([f]) => f !== '//').flatMap(([, p]) => p as string[]),
    ];
    expect(named.filter((n) => available[n] === undefined)).toEqual([]);
  });

  it('the toolchain is the one the gate steps call by name', () => {
    const gate = read('verify.sh');
    for (const tool of ['eslint', 'tsc', 'jest']) expect(gate).toContain(tool);
  });

  it('names every script that may be left out, and why it may be', () => {
    for (const [answer, scripts] of Object.entries(manifest.dependencies.onlyWith)) {
      if (answer === '//') continue;
      for (const script of scripts as string[]) {
        expect(Object.keys(declared)).toContain(script);
      }
    }
  });
});
