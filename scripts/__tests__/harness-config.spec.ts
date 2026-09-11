import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * What the harness knows about the project it guards, and the proof that it
 * knows it from one file rather than from eight.
 *
 * Every value in `harness.config.json` was a literal inside a script until
 * 2026-09-11. That was fine while there was one project and fatal for a
 * template: a generator would have copied `apps/api/src/config` into a
 * repository with no apps/api, and the guard reading it would have gone quiet
 * rather than red. A guard that checks nothing reports success forever.
 *
 * So the load-bearing case here is the last describe block: the literals are
 * gone from the scripts. Everything above it is about failing loudly when the
 * configuration is wrong, because the alternative — `undefined` flowing into a
 * guard — is the same silent success by another route.
 */
const REPO = path.resolve(__dirname, '..', '..');
const LOADER = path.join(REPO, 'scripts', 'harness-config.mjs');
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), 'utf8');

const config = JSON.parse(read('harness.config.json')) as Record<string, never>;
const manifest = JSON.parse(read('harness.manifest.json')) as {
  configured: { scripts: Record<string, string[]> };
};

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** Loads a configuration of the caller's choosing, in its own process. */
function load(contents: unknown | string): { ok: boolean; error: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-config-'));
  made.push(dir);
  mkdirSync(path.join(dir, 'scripts'));
  copyFileSync(LOADER, path.join(dir, 'scripts', 'harness-config.mjs'));
  if (contents !== undefined) {
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
  }
  try {
    execFileSync(
      'node',
      ['-e', `import('./scripts/harness-config.mjs').then(m => m.loadConfig())`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, error: '' };
  } catch (error) {
    return { ok: false, error: String((error as { stderr?: string }).stderr ?? '') };
  }
}

describe('it refuses a configuration it cannot trust', () => {
  it('loads this repository\'s own, so the refusals below mean something', () => {
    expect(load(config).ok).toBe(true);
  });

  it('refuses an absent file, and says what to do about it', () => {
    const { ok, error } = load(undefined);
    expect(ok).toBe(false);
    expect(error).toContain('is missing');
    expect(error).toContain('template');
  });

  it('refuses a file that does not parse, rather than throwing a bare SyntaxError', () => {
    const { ok, error } = load('{ not json');
    expect(ok).toBe(false);
    expect(error).toContain('does not parse');
  });

  it.each([
    ['coverage.sources', { ...config, coverage: { sources: [] } }],
    ['ports.api', { ...config, ports: { api: 'three thousand', web: 5273 } }],
    ['verifyProbe.path', { ...config, verifyProbe: { path: 'somewhere.js' } }],
    ['database.testSuffix', { ...config, database: { required: true, testSuffix: '' } }],
    ['migrations.directory', { ...config, migrations: {} }],
  ])('refuses a malformed %s by name', (key, broken) => {
    const { ok, error } = load(broken);
    expect(ok).toBe(false);
    expect(error).toContain(key);
  });

  it('names every malformed key at once, so one run fixes one round', () => {
    const { error } = load({ ...config, ports: {}, migrations: {} });
    expect(error).toContain('ports.api');
    expect(error).toContain('migrations.directory');
  });

  it('says why a missing key matters, not only that it is missing', () => {
    // The reason is the whole point: `undefined` reaching a guard makes it
    // check nothing and report success, which is worse than a crash.
    expect(load({ ...config, ports: {} }).error).toMatch(/checks nothing and reports success/u);
  });

  it('allows a null contracts package, for a project without a shared one', () => {
    expect(load({ ...config, contracts: { package: null } }).ok).toBe(true);
  });
});

describe('the test suffix, which is the whole of what keeps --yes off a real database', () => {
  /**
   * Made configurable on 2026-09-11 so a project naming its test databases
   * differently need not edit `migrate.mjs` — and editing the file that decides
   * when a migration may run unattended is exactly what should not be routine.
   *
   * Configurable is not the same as free. A suffix of `b` would make every
   * database whose name ends in b fair game for an unattended migration, which
   * is I8 deleted rather than parameterised.
   */
  const withSuffix = (testSuffix: string) => load({ ...config, database: { ...(config as unknown as { database: object }).database, testSuffix } });

  it.each(['_test', '_disposable', '_scratch_db'])('accepts %s, which reads as deliberate', (suffix) => {
    expect(withSuffix(suffix).ok).toBe(true);
  });

  it.each([
    ['b', 'a single letter matches half the databases on a server'],
    ['test', 'no underscore, so `latest` would qualify'],
    ['_ab', 'too short to be an accident anybody would notice'],
    ['', 'everything qualifies'],
  ])('refuses %s: %s', (suffix) => {
    expect(withSuffix(suffix).ok).toBe(false);
  });

  it('names the key when it refuses, so the reader knows which one', () => {
    expect(withSuffix('b').error).toContain('database.testSuffix');
  });

  it('migrate.mjs reads it rather than carrying its own', () => {
    const code = readFileSync(path.join(REPO, 'scripts', 'migrate.mjs'), 'utf8');
    expect(code).toContain("from './harness-config.mjs'");
    expect(code).toContain('endsWith(suffix)');
    expect(code.split('\n').filter((l) => !l.trim().startsWith('*')).join('\n')).not.toContain("endsWith('_test')");
  });
});

describe('the literals are gone from the scripts', () => {
  /**
   * The case this file exists for. Each script named in the manifest's
   * `configured` tier must no longer carry the value it used to hardcode.
   * Comments are stripped first: several of these scripts explain the old
   * literal in prose, which is worth keeping and is not a coupling.
   */
  const withoutComments = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

  const CONVERTED: Record<string, string[]> = {
    'scripts/check-migrations.mjs': ["const DIR = 'migrations'"],
    'scripts/migrate.mjs': ["endsWith('_test')"],
    'scripts/check-verify.mjs': ['apps/api/src/config/__verify_probe.ts'],
    'scripts/check-coverage.mjs': ["'apps/api/src'", "'apps/web/src'"],
    'scripts/check-environment.mjs': ['portFree(3100)', 'portFree(5273)'],
    'scripts/pr-review-brief.mjs': ["'apps/api/src/controller/'", "'apps/api/src/repo/'"],
    'scripts/progress.mjs': ['`packages/contracts`'],
  };

  it('every converted script is in the manifest\'s configured tier', () => {
    for (const file of Object.keys(CONVERTED)) {
      expect(Object.keys(manifest.configured.scripts)).toContain(file);
    }
  });

  it.each(Object.entries(CONVERTED))('%s no longer carries its old literals', (file, literals) => {
    const code = withoutComments(read(file));
    expect((literals as string[]).filter((l) => code.includes(l))).toEqual([]);
  });

  it.each(Object.keys(CONVERTED))('%s reads the configuration instead', (file) => {
    expect(read(file)).toContain("from './harness-config.mjs'");
  });

  it('the stripper would let the literals through, so the cases above can fail', () => {
    // Without this the cases above would pass for a stripper that removed
    // everything, which is how an assertion quietly stops meaning anything.
    //
    // In link-shortener this asked git history: `git log -S` for the literal
    // in the commit that removed it. This repository was seeded after the
    // conversion, as one commit (HANDOVER.md), so its history has no such
    // commit to find and never will. What can be proved here is the half that
    // does not depend on where the code came from: a literal in code survives
    // the stripper, and the same literal in a comment does not.
    const literal = "const DIR = 'migrations'";
    expect(withoutComments(`${literal};\nexport {};\n`)).toContain(literal);
    expect(withoutComments(`// ${literal}\n/* ${literal} */\n * ${literal}\n`)).not.toContain(literal);
  });
});

describe('the configuration describes this repository', () => {
  it('its coverage sources are the areas coverage-floor.json floors', () => {
    const floors = Object.keys(JSON.parse(read('coverage-floor.json')).areas as object);
    for (const source of (config as unknown as { coverage: { sources: string[] } }).coverage.sources) {
      // `packages` covers `packages/contracts/src`, so the match is by prefix.
      expect(floors.some((f) => f.replace('./', '').startsWith(source.split('/')[0] ?? source))).toBe(true);
    }
  });

  it('its probe path is inside a project the typecheck covers', () => {
    // check-verify.mjs writes a deliberate type error there and expects step
    // 02 to go red. A path outside every project reference is a probe the
    // compiler never sees, and a witness run that passes for the wrong reason.
    const probe = (config as unknown as { verifyProbe: { path: string } }).verifyProbe.path;
    const refs = (JSON.parse(read('tsconfig.build.json')) as { references: { path: string }[] }).references.map(
      (r) => r.path.replace(/^\.\//u, ''),
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => probe.startsWith(`${r}/`))).toBe(true);
    expect(probe.endsWith('.ts')).toBe(true);
  });

  it('its migrations directory is the one that exists, when there is a database', () => {
    const { migrations, database } = config as unknown as {
      migrations: { directory: string };
      database: { required: boolean };
    };
    if (!database.required) {
      // No database, no migrations: the generator writes neither, and a
      // directory here would be one nothing applies.
      expect(existsSync(path.join(REPO, migrations.directory))).toBe(false);
      return;
    }
    expect(read(path.join(migrations.directory, 'README.md')).length).toBeGreaterThan(0);
  });
});
