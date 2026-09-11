import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The generator, held to one bar: **the project it writes passes its own
 * `./verify.sh` on the first run.** A scaffold that leaves somebody with a red
 * gate has taught its first lesson backwards.
 *
 * That bar is met by running it, not by these cases. Scaffolding, installing
 * and gating a project takes about a minute, which is the wrong price on every
 * commit; it was done by hand on 2026-09-11 and the result is in PROGRESS.md
 * and in the pull request. What is asserted here is everything that would make
 * that run fail — the step list, the file set, the configuration — because
 * those are what change.
 *
 * Five defects were found by that one run, and every one of them is a case
 * below.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'harness-init.mjs');

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

type Plan = {
  into: string;
  steps: { n: string; name: string; command: string }[];
  deferred: { n: string; name: string; command: string; because: string }[];
  copied: string[];
  generated: string[];
};

function plan(extra: string[] = []): Plan {
  const out = execFileSync(
    'node',
    [SCRIPT, '--yes', '--name', 'probe', '--plan', ...extra],
    { cwd: REPO, encoding: 'utf8' },
  );
  return JSON.parse(out) as Plan;
}

function scaffold(extra: string[] = []): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'harness-init-')), 'probe');
  made.push(path.dirname(dir));
  execFileSync('node', [SCRIPT, '--yes', '--name', 'probe', '--into', dir, ...extra], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return dir;
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), 'utf8');

describe('the steps a project gets', () => {
  it('leaves out a step whose requirement does not exist', () => {
    // A gate with a step that cannot pass is a gate people learn to run with
    // `|| true`, which is worse than a gate with fewer steps.
    expect(plan().steps.map((s) => s.name)).toEqual([
      'eslint',
      'typecheck',
      'unit',
      'feature-list',
      'verify-log',
      'coverage',
    ]);
  });

  it('puts no step in the gate that nothing can pass, whatever was answered', () => {
    // The trap this replaced: --database and --browser used to put steps 04,
    // 05 and 09 straight in, and nothing generates an API, a migration or a
    // Playwright suite to satisfy them. The generated project's gate was red
    // on its first run, which is the one lesson this must not teach.
    for (const extra of [[], ['--database'], ['--browser'], ['--database', '--browser']]) {
      expect(plan(extra).steps.map((s) => s.name)).toEqual([
        'eslint',
        'typecheck',
        'unit',
        'feature-list',
        'verify-log',
        'coverage',
      ]);
    }
  });

  it('defers the steps an answer implies, rather than dropping them silently', () => {
    // Step 04 waits on the API rather than on the database, which is where it
    // used to be filed. A project can have Postgres and no HTTP surface at all,
    // and telling that project to add an api-e2e step is telling it to add a
    // step for something it does not have.
    expect(plan(['--database']).deferred.map((s) => s.name)).toEqual(['migrations']);
    expect(plan(['--api']).deferred.map((s) => s.name)).toEqual(['api-e2e']);
    expect(plan(['--browser']).deferred.map((s) => s.name)).toEqual(['browser-e2e']);
    expect(plan().deferred).toEqual([]);
  });

  it('gives each deferred step its own reason, since they wait for different things', () => {
    const reasons = plan(['--database', '--api']).deferred.map((s) => s.because);
    expect(new Set(reasons).size).toBe(2);
    expect(reasons.join(' ')).toContain('migrations/');
  });

  it('says that both e2e steps need Postgres, because both of them do', () => {
    // Read out of verify.sh on 2026-09-11 rather than assumed: `api_e2e` and
    // `browser_e2e` each call `prepare_test_database` before running anything.
    // So a browser-only project that takes "add it when a Playwright suite
    // exists" at face value adds the line and watches step 05 die on a
    // connection it never knew it needed.
    const because = Object.fromEntries(
      plan(['--api', '--web']).deferred.map((s) => [s.name, s.because]),
    );
    expect(because['api-e2e']).toContain('prepare_test_database');
    expect(because['browser-e2e']).toContain('prepare_test_database');
  });

  it('keeps the numbers the steps already have, rather than renumbering', () => {
    // 01, 02, 03, 06, 07, 08 with gaps. Renumbering would make a log line from
    // one project unreadable beside another's, and the names are what a person
    // actually reads.
    expect(plan().steps.map((s) => s.n)).toEqual(['01', '02', '03', '06', '07', '08']);
  });
});

describe('the gate it writes', () => {
  it('carries only the chosen steps', () => {
    const gate = read(scaffold(), 'verify.sh');
    const steps = [...gate.matchAll(/^run_step \d\d (\S+)/gmu)].map((m) => m[1]);
    expect(steps).toEqual(['eslint', 'typecheck', 'unit', 'feature-list', 'verify-log', 'coverage']);
  });

  it('keeps everything above the step list byte for byte, because that part is the mechanism', () => {
    const source = readFileSync(path.join(REPO, 'verify.sh'), 'utf8');
    const generated = read(scaffold(), 'verify.sh');
    const upTo = (text: string) => text.slice(0, text.indexOf('run_step 01 '));
    expect(upTo(generated)).toBe(upTo(source));
  });

  it('is executable, or the first instruction in its own output fails', () => {
    const gate = path.join(scaffold(), 'verify.sh');
    expect(execFileSync('test', ['-x', gate], { encoding: 'utf8' })).toBe('');
  });

  it('refuses a source with no run_step block rather than writing a gate with no steps', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-init-bad-'));
    made.push(dir);
    writeFileSync(path.join(dir, 'fake.sh'), '#!/usr/bin/env bash\necho nothing\n');
    // Driven through the module rather than the CLI: the CLI reads this
    // repository's verify.sh, which does have a block.
    const probe = `
      import { renderVerify } from ${JSON.stringify(SCRIPT)};
      try { renderVerify('#!/bin/sh\\necho hi\\n', [{ n: '01', name: 'a', command: 'b' }]); }
      catch (e) { console.log(e.message); }
    `;
    const out = execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    expect(out).toContain('no run_step block');
  });
});

describe('the files it copies', () => {
  it('copies the scripts the gate calls, not only the core tier', () => {
    // The first run of this generator copied `core` alone and produced a gate
    // whose steps called scripts that were not there: the tiers differ in
    // whether a file reads harness.config.json, not in whether it is copied.
    const copied = plan().copied;
    expect(copied).toContain('scripts/check-feature-list.mjs');
    expect(copied).toContain('scripts/check-coverage.mjs');
    expect(copied).toContain('scripts/verify-log.mjs');
  });

  it('copies no guard suite, because they assert this repository', () => {
    // Copying them failed twelve at once: docs-drift checks tables nobody has
    // written yet, and a project adopting a harness should not inherit six
    // hundred assertions about a harness it did not write.
    expect(plan().copied.filter((f) => f.includes('__tests__'))).toEqual([]);
  });

  it('leaves migrate.mjs out of a project with no database, since it imports pg', () => {
    // Found by the generate job the day the scripts carried // @ts-check: a
    // project without pg could not typecheck a script that imports it, and
    // the three variants without a database went red at step 02.
    expect(plan().copied).not.toContain('scripts/migrate.mjs');
    expect(plan(['--database']).copied).toContain('scripts/migrate.mjs');
    expect(existsSync(path.join(scaffold(), 'scripts', 'migrate.mjs'))).toBe(false);
  });

  it('every file it claims to copy exists here', () => {
    expect(plan().copied.filter((f) => !existsSync(path.join(REPO, f)))).toEqual([]);
  });

  it('leaves scripts/__tests__ empty and the gate green anyway', () => {
    const dir = scaffold();
    expect(existsSync(path.join(dir, 'scripts', '__tests__'))).toBe(false);
    expect(read(dir, 'jest.config.cjs')).toContain('passWithNoTests: true');
  });
});

describe('the project it writes', () => {
  it('has something for the gate to verify, or step 03 verifies nothing', () => {
    const dir = scaffold();
    expect(read(dir, 'packages/core/src/index.ts')).toContain('export function greet');
    expect(read(dir, 'packages/core/src/index.spec.ts')).toContain('refuses an empty name');
  });

  it('declares js-yaml, which a copied script imports at runtime', () => {
    // Found by the generated project failing to run inbox.mjs.
    expect(JSON.parse(read(scaffold(), 'package.json')).devDependencies['js-yaml']).toBeDefined();
  });

  it('takes its versions from this repository rather than carrying its own', () => {
    // The first version hardcoded js-yaml ^4 while this repository had ^5, so
    // a new project would have got a different major of the library the copied
    // script was written against.
    const mine = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const available = { ...mine.dependencies, ...mine.devDependencies };
    const theirs = JSON.parse(read(scaffold(), 'package.json')).devDependencies;
    for (const [name, version] of Object.entries(theirs)) {
      expect(version).toBe(available[name]);
    }
  });

  it('leaves out a dependency nothing in the project would import', () => {
    // `pg` in a project with no database is a package nothing imports, and an
    // unused dependency is one nobody can tell is unused later.
    expect(JSON.parse(read(scaffold(), 'package.json')).devDependencies.pg).toBeUndefined();
    expect(JSON.parse(read(scaffold(['--database']), 'package.json')).devDependencies.pg).toBeDefined();
  });

  it('names the package manager, which the copied CI workflow reads', () => {
    // pnpm/action-setup@v4 takes the version from `packageManager` and fails
    // without one. The generated project gets this repository's, so the two
    // run the same pnpm.
    const mine = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { packageManager: string };
    expect(mine.packageManager).toMatch(/^pnpm@\d/u);
    expect(JSON.parse(read(scaffold(), 'package.json')).packageManager).toBe(mine.packageManager);
  });

  it('installs the toolchain the gate steps call by name', () => {
    const deps = JSON.parse(read(scaffold(), 'package.json')).devDependencies;
    for (const tool of ['eslint', 'typescript', 'jest', 'ts-jest']) {
      expect(deps[tool]).toBeDefined();
    }
  });

  it('refuses to resolve a package this repository does not have', () => {
    // The manifest names packages and package.json gives versions. A name with
    // no version is a generated project that cannot install, and saying so at
    // generation time is cheaper than at `pnpm install`.
    const probe = `
      import { dependenciesFor } from ${JSON.stringify(SCRIPT)};
      const manifest = { dependencies: { toolchain: { packages: ['not-a-real-package-xyz'] }, scripts: {}, onlyWith: {} } };
      try { dependenciesFor(manifest, {}); } catch (e) { console.log(e.message); }
    `;
    const out = execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    expect(out).toContain('not-a-real-package-xyz');
    expect(out).toContain('can give a version for');
  });

  it('sends coverage to the run\'s own evidence folder, where step 08 looks for it', () => {
    expect(read(scaffold(), 'jest.config.cjs')).toContain('EVIDENCE_DIR');
  });

  it('names every case in its evidence, as this repository does', () => {
    // The spec-auditor reads 03-unit.log to find the assertion a contract
    // names, and Jest 30 prints neither PASS lines nor case names without an
    // explicit reporter. A generated project's evidence should be readable
    // the same way.
    const config = read(scaffold(), 'jest.config.cjs');
    expect(config).toContain('verbose: true');
    expect(config).toContain("reporters: ['default']");
  });

  it('allows the unused-argument style the copied scripts use', () => {
    expect(read(scaffold(), 'eslint.config.mjs')).toContain('argsIgnorePattern');
  });

  it('writes a configuration with no database when there is none', () => {
    const config = JSON.parse(read(scaffold(), 'harness.config.json'));
    expect(config.database.required).toBe(false);
    expect(config.attackSurface.paths).toEqual([]);
  });

  it('writes a configuration the harness loader accepts', () => {
    // The loader is the thing every copied script reads, so a generated
    // configuration it refuses would make the new project's gate red for a
    // reason the person did not cause. A file URL, because a dynamic import of
    // an absolute path is not one.
    const dir = scaffold();
    const loader = pathToFileURL(path.join(REPO, 'scripts', 'harness-config.mjs')).href;
    const config = path.join(dir, 'harness.config.json');
    execFileSync(
      'node',
      ['-e', `import(${JSON.stringify(loader)}).then(m => m.loadConfig(${JSON.stringify(config)}))`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('seeds a journal with an entry, since the stop hook asks for one', () => {
    expect(read(scaffold(), 'PROGRESS.md')).toMatch(/^## \d{4}-\d{2}-\d{2} — /mu);
  });

  it('seeds AGENTS.md with the step count it actually generated, not the one implied', () => {
    expect(read(scaffold(), 'AGENTS.md')).toContain('`./verify.sh` is 6 steps');
    expect(read(scaffold(['--database', '--browser']), 'AGENTS.md')).toContain('`./verify.sh` is 6 steps');
  });

  it('tells the new project which steps are missing and the line to add for each', () => {
    const agents = read(scaffold(['--database', '--api']), 'AGENTS.md');
    expect(agents).toContain('Steps this gate does not have yet');
    expect(agents).toContain('run_step 04 api-e2e');
    expect(agents).toContain('run_step 09 migrations');
    expect(agents).toContain('add it when migrations/ holds its first .sql file');
  });

  it('says nothing about missing steps when none were implied', () => {
    expect(read(scaffold(), 'AGENTS.md')).not.toContain('Steps this gate does not have yet');
  });

  it('generates what a database needs, rather than only naming it', () => {
    const dir = scaffold(['--database']);
    expect(read(dir, 'docker-compose.yml')).toContain('postgres');
    expect(read(dir, 'migrations/README.md')).toContain('_test');
    expect(JSON.parse(read(dir, 'harness.config.json')).database.required).toBe(true);
    expect(JSON.parse(read(dir, 'package.json')).scripts.migrate).toBeDefined();
  });

  it('generates no database files when there is no database', () => {
    expect(existsSync(path.join(scaffold(), 'docker-compose.yml'))).toBe(false);
  });

  it('gives the project the invariants the harness already enforces, and a place for its own', () => {
    // The spec-auditor cites docs/INVARIANTS.md by number and the shipped
    // scripts print I8, I11, I12 and I15 in their refusals. A project without
    // the file has an auditor reading nothing and refusals that cite nothing.
    const invariants = read(scaffold(), 'docs/INVARIANTS.md');
    for (const n of ['I8', 'I11', 'I12', 'I15']) expect(invariants).toMatch(new RegExp(`^## ${n} — `, 'mu'));
    expect(invariants).toContain('## Yours to add');
    expect(invariants).not.toMatch(/shortener_test|link\.anhile/u);
  });

  it('gives the project an empty domain-rules file in the shape intake reads', () => {
    // A rule the generator wrote would be about a product it has never seen;
    // the shape is what travels, and R1 is a placeholder to overwrite.
    const rules = read(scaffold(), 'docs/DOMAIN_RULES.md');
    expect(rules).toContain('a spec for probe');
    expect(rules).toMatch(/^\| R1 \| </mu);
    expect(rules).not.toMatch(/generated project passes|harness\.versions/u);
  });

  it('gives the project a CONTRIBUTING.md, which the pull request template points at', () => {
    const dir = scaffold();
    expect(read(dir, 'CONTRIBUTING.md')).toMatch(/retract/iu);
    expect(read(dir, '.github/pull_request_template.md')).toContain('CONTRIBUTING.md');
  });

  it('says in AGENTS.md what the person still has to write', () => {
    // A harness with no invariants and no domain rules checks that the code
    // compiles and little else, and saying so is more useful than implying
    // the generated project is finished.
    const agents = read(scaffold(), 'AGENTS.md');
    expect(agents).toContain('docs/INVARIANTS.md');
    expect(agents).toContain('docs/DOMAIN_RULES.md');
  });
});

describe('the applications it scaffolds', () => {
  /**
   * The bar for these is the same as for everything else the generator writes:
   * the project passes its own gate on the first run. Four combinations —
   * neither app, each alone, and both — were scaffolded, installed and gated by
   * hand on 2026-09-11 and all four reached `RESULT: PASS (6/6 steps)`. Doing
   * that here would cost four minutes a commit.
   *
   * What is asserted instead is what made the first attempt fail, and what
   * would make the next one fail quietly: the compiler configuration, the test
   * wiring, and the accounting that stops an untested file from being
   * invisible.
   */
  it('writes neither application unless it was asked for', () => {
    const dir = scaffold();
    expect(existsSync(path.join(dir, 'apps'))).toBe(false);
    expect(existsSync(path.join(dir, 'vercel.json'))).toBe(false);
  });

  it('gives the API a test that would fail if the code were wrong', () => {
    // A scaffold that writes plausible code with no test teaches the opposite
    // of what the rest of this harness is for.
    const dir = scaffold(['--api']);
    const spec = read(dir, 'apps/api/src/config/serverless.spec.ts');
    expect(spec).toContain('forgets a failed boot');
    expect(read(dir, 'apps/api/src/config/serverless.ts')).toContain('started = null');
  });

  it('has the API import its build output, never its source', () => {
    // Nest needs legacy decorators; the platform compiles api/index.ts against
    // the repository root, which does not enable them, and emits standard ES
    // decorators whose call signature differs. Every controller then dies at
    // import — on a deployment that built perfectly.
    const entry = read(scaffold(['--api']), 'api/index.ts');
    expect(entry).toContain("from '../apps/api/dist/app.module'");
    expect(entry).not.toContain('apps/api/src');
  });

  it('typechecks that entry point at all, which is the part that was missing', () => {
    // api/ is in none of the workspace projects, so without its own project it
    // is the one file that runs in production and nothing checks. It is
    // referenced last, because it consumes what apps/api emits.
    const dir = scaffold(['--api']);
    const refs = (JSON.parse(read(dir, 'tsconfig.build.json')) as { references: { path: string }[] })
      .references;
    expect(refs.map((r) => r.path)).toEqual([
      './packages/core',
      './apps/api',
      './tsconfig.functions.json',
      './tsconfig.scripts.json',
    ]);
    const functions = JSON.parse(read(dir, 'tsconfig.functions.json')) as {
      compilerOptions: { module: string };
    };
    // CommonJS, against a NodeNext base. Under the base this file cannot import
    // what apps/api emits at all, and the first generated project was red here.
    expect(functions.compilerOptions.module).toBe('commonjs');
  });

  it('typechecks the copied scripts, so their @ts-check is not decoration', () => {
    // Every script the generator copies carries `// @ts-check` and JSDoc. In
    // a project whose typecheck did not include them, the directive would
    // check nothing and look as if it did.
    const dir = scaffold();
    const refs = (JSON.parse(read(dir, 'tsconfig.build.json')) as { references: { path: string }[] }).references;
    expect(refs.map((r) => r.path)).toContain('./tsconfig.scripts.json');
    const scripts = JSON.parse(read(dir, 'tsconfig.scripts.json')) as { include: string[]; compilerOptions: { allowJs: boolean } };
    expect(scripts.include).toContain('scripts/*.mjs');
    expect(scripts.compilerOptions.allowJs).toBe(true);
    const unchecked = readdirSync(path.join(dir, 'scripts'))
      .filter((f) => f.endsWith('.mjs'))
      .filter((f) => !read(dir, `scripts/${f}`).includes('// @ts-check'));
    expect(unchecked).toEqual([]);
  });

  it('gives each application the jest project its compiler needs', () => {
    // apps/api is CommonJS with decorators and apps/web is JSX in a DOM;
    // neither can be compiled by the other's tsconfig, and one shared project
    // would fail whichever it was not written for.
    const config = read(scaffold(['--api', '--web']), 'jest.config.cjs');
    expect(config).toContain("displayName: 'api-unit'");
    expect(config).toContain("tsconfig: '<rootDir>/apps/api/tsconfig.json'");
    expect(config).toContain("testEnvironment: 'jsdom'");
    expect(config).toContain("tsconfig: '<rootDir>/apps/web/tsconfig.jest.json'");
  });

  it('stops collecting coverage from a fixed list once there are several compilers', () => {
    // A root-level collectCoverageFrom applies to every project, so each one
    // instruments the others' files with its own tsconfig — and apps/api's has
    // a rootDir of `src`, which makes every packages/ file handed to it a
    // TS6059. Jest measures what the tests import instead.
    expect(read(scaffold(), 'jest.config.cjs')).toContain('collectCoverageFrom');
    expect(read(scaffold(['--api']), 'jest.config.cjs')).not.toContain('collectCoverageFrom');
  });

  it('accounts for the files no test imports, rather than letting them vanish', () => {
    // Jest measures what its tests import, so an unimported file is invisible
    // to coverage and could never lower a floor. check-coverage.mjs refuses a
    // source file that is in neither the report nor this list — which means a
    // generated project with an unlisted entry point is red on its first run.
    const floor = JSON.parse(read(scaffold(['--api', '--web']), 'coverage-floor.json')) as {
      areas: Record<string, unknown>;
      unmeasured: Record<string, string>;
    };
    expect(Object.keys(floor.unmeasured).sort()).toEqual([
      'apps/api/src/app.module.ts',
      'apps/api/src/main.ts',
      'apps/web/src/main.tsx',
    ]);
    for (const reason of Object.values(floor.unmeasured)) expect(reason.length).toBeGreaterThan(20);
    expect(Object.keys(floor.areas)).toContain('./apps/api/src/');
  });

  it('widens what a reviewer is pointed at when there is a surface to review', () => {
    const config = JSON.parse(read(scaffold(['--api']), 'harness.config.json')) as {
      attackSurface: { paths: string[] };
      coverage: { sources: string[] };
    };
    expect(config.attackSurface.paths).toContain('apps/api/src/controller/');
    expect(config.attackSurface.paths).toContain('vercel.json');
    expect(config.coverage.sources).toContain('apps');
  });

  it('installs React only for a project that has a page', () => {
    const withWeb = JSON.parse(read(scaffold(['--web']), 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    const without = JSON.parse(read(scaffold(['--api']), 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(withWeb.devDependencies['react']).toBeDefined();
    expect(withWeb.devDependencies['@nestjs/core']).toBeUndefined();
    expect(without.devDependencies['react']).toBeUndefined();
    expect(without.devDependencies['@nestjs/core']).toBeDefined();
  });

  it('takes the app versions from harness.versions.json, where this repository keeps them', () => {
    // In link-shortener React's version was in apps/web/package.json and
    // nowhere else. This repository is the harness alone and has no page, so
    // the versions the templates were written against are recorded once, in
    // harness.versions.json, and a generated project gets exactly those.
    const mine = JSON.parse(readFileSync(path.join(REPO, 'harness.versions.json'), 'utf8')) as {
      versions: Record<string, string>;
    };
    const generated = JSON.parse(read(scaffold(['--web']), 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(mine.versions['react']).toBeDefined();
    expect(generated.devDependencies['react']).toBe(mine.versions['react']);
  });

  it('routes every path through the function by query parameter, not by depth', () => {
    // A catch-all matched exactly one segment however it was declared, so
    // /api/links reached the application and /api/links/{code}/stats returned
    // the platform's own 404. Putting the path in __p makes depth stop meaning
    // anything, and the handler is what puts it back.
    const vercel = JSON.parse(read(scaffold(['--api']), 'vercel.json')) as {
      rewrites: { source: string; destination: string }[];
    };
    expect(vercel.rewrites[0]?.destination).toBe('/api?__p=/$1');
    expect(read(scaffold(['--api']), 'apps/api/src/config/serverless.ts')).toContain('__p');
  });
});

describe('the MCP servers it declares', () => {
  it('writes nothing when none were chosen', () => {
    expect(existsSync(path.join(scaffold(), '.mcp.json'))).toBe(false);
  });

  it('writes a file a client will actually load', () => {
    // No comment keys, however tempting: a client that validates this file
    // stops loading it, and an MCP server that silently does not exist is
    // worse than one that was never declared.
    const config = JSON.parse(read(scaffold(['--mcp', 'context7,vercel']), '.mcp.json')) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(Object.keys(config.mcpServers)).toEqual(['context7', 'vercel']);
    for (const server of Object.values(config.mcpServers)) {
      expect(Object.keys(server).sort()).toEqual(['type', 'url']);
      expect(server.url.startsWith('https://')).toBe(true);
    }
  });

  it('says in AGENTS.md what each one is for', () => {
    // A server whose purpose nobody can state is a tool call nobody should
    // make. The reason has to live where an agent reads, not in the JSON.
    const agents = read(scaffold(['--mcp', 'context7']), 'AGENTS.md');
    expect(agents).toContain('## MCP servers');
    expect(agents).toContain('context7');
    expect(agents).toContain('authorised');
  });

  it('refuses a server it does not know, rather than writing a file that does nothing', () => {
    expect(() => scaffold(['--mcp', 'not-a-server'])).toThrow(/unknown MCP server/u);
  });
});

describe('the choice a person makes', () => {
  /**
   * Flags were the first interface and they were the wrong one: somebody
   * running this has not read the file, so `--database --api` is a list they
   * cannot see and cannot be told the consequences of. What is asserted here is
   * the parsing, because that is where a silent wrong answer would come from.
   */
  /**
   * In a child node, like the other probes here: ts-jest compiles this file to
   * CommonJS, so a dynamic `import()` of an .mjs becomes a `require` and fails
   * on the first `export`.
   */
  const probe = (body: string): string =>
    execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import { PARTS, parseChoice } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
         const attempt = (fn) => { try { return JSON.stringify(fn()); } catch (e) { return 'ERR ' + e.message; } };
         ${body}`,
      ],
      { encoding: 'utf8' },
    ).trim();

  it('reads numbers however they were separated', () => {
    expect(probe("console.log(attempt(() => [parseChoice('1 3', 3), parseChoice('1, 3', 3), parseChoice('', 3)]))")).toBe(
      '[[0,2],[0,2],[]]',
    );
  });

  it('takes each choice once, however many times it was typed', () => {
    expect(probe("console.log(attempt(() => parseChoice('2 2 2', 3)))")).toBe('[1]');
  });

  it('refuses a token it cannot read instead of treating it as nothing chosen', () => {
    // A typo read as a silent "none" would produce an empty project that looks
    // like the one that was asked for, which is the worst of the outcomes here:
    // it is not noticed until somebody goes looking for the API.
    expect(probe("console.log(attempt(() => parseChoice('2 x', 3)))")).toContain('"x" is not one of the numbers');
    expect(probe("console.log(attempt(() => parseChoice('4', 3)))")).toContain('1-3');
    expect(probe("console.log(attempt(() => parseChoice('0', 3)))")).toContain('1-3');
  });

  it('offers every part the generator can actually write, and says what each costs', () => {
    // A menu that only names the parts makes the person guess at the
    // consequence, and two of these defer a gate step rather than adding one.
    expect(probe('console.log(attempt(() => PARTS.map((p) => p.key)))')).toBe('["database","api","web"]');
    expect(probe('console.log(attempt(() => PARTS.every((p) => p.detail.length > 40)))')).toBe('true');
  });
});

describe('what it refuses', () => {
  it('refuses a directory that is not empty, rather than merging into it', () => {
    const dir = scaffold();
    let message = '';
    try {
      execFileSync('node', [SCRIPT, '--yes', '--name', 'probe', '--into', dir], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      message = String((error as { stderr?: string }).stderr ?? '');
    }
    expect(message).toContain('is not empty');
  });
});
