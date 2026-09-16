#!/usr/bin/env node
// @ts-check
/**
 * Create a new project with this harness already in it.
 *
 * The bar this is built to, and the only one worth having: **the project it
 * writes passes its own `./verify.sh` on the first run.** A scaffold that
 * leaves you with a red gate has taught its first lesson backwards.
 *
 * Which is why the steps are generated rather than copied. `harness.manifest.json`
 * put `verify.sh` in `core`, meaning copied verbatim, and building this proved
 * that wrong within an hour: the step list is *this* project's, and a repository
 * with no Postgres and no browser cannot run steps 04, 05 and 09. So the file
 * is copied and its `run_step` block rewritten from the answers below. That is
 * the boundary doing its job — it was written to be falsified by the generator,
 * and it was.
 *
 *   node scripts/harness-init.mjs                     # asks
 *   node scripts/harness-init.mjs --name my-thing --into ../my-thing --yes
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, MCP, WEB, mcpConfig, vercelConfig } from './harness-templates.mjs';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

/**
 * What a project said it has, from the prompt or from --yes flags.
 * @typedef {{ name: string, database: boolean, api: boolean, web: boolean, browser: boolean, mcp: string[] }} Answers
 */

/**
 * One gate step, and what has to exist for it to be in the gate.
 * @typedef {{ n: string, name: string, command: string, needs: 'api' | 'browser' | 'database' | null }} Step
 */

/** @typedef {Step & { because: string }} DeferredStep */

/**
 * harness.manifest.json; only what the generator reads.
 * @typedef {{
 *   core: { scripts: string[] },
 *   configured: { scripts: Record<string, unknown> },
 *   elsewhere: { core: string[] },
 *   dependencies: {
 *     toolchain: { packages: string[] },
 *     onlyWith: Record<string, string[] | string>,
 *     scripts: Record<string, string[] | string>,
 *     apps?: Record<string, string[] | string>,
 *   },
 * }} Manifest
 */

/** @param {string} rel */
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/**
 * Steps a generated project gets, and what each one needs to exist. A step
 * whose requirement is absent is left out rather than shipped broken: a gate
 * with a step that cannot pass is a gate people learn to run with `|| true`.
 */
/** @type {Step[]} */
export const STEPS = [
  { n: '01', name: 'eslint', command: 'pnpm exec eslint .', needs: null },
  { n: '02', name: 'typecheck', command: 'pnpm exec tsc -b --force tsconfig.build.json', needs: null },
  { n: '03', name: 'unit', command: 'pnpm exec jest --config jest.config.cjs', needs: null },
  { n: '04', name: 'api-e2e', command: 'api_e2e', needs: 'api' },
  { n: '05', name: 'browser-e2e', command: 'browser_e2e', needs: 'browser' },
  { n: '06', name: 'feature-list', command: 'node scripts/check-feature-list.mjs', needs: null },
  { n: '07', name: 'verify-log', command: 'node scripts/verify-log.mjs check', needs: null },
  { n: '08', name: 'coverage', command: 'node scripts/check-coverage.mjs', needs: null },
  { n: '09', name: 'migrations', command: 'node scripts/check-migrations.mjs', needs: 'database' },
];

/**
 * The steps a generated project can actually pass today, and the ones its
 * answers imply but nothing yet satisfies.
 *
 * `--database` and `--browser` used to put steps 04, 05 and 09 straight into
 * the gate, which was a trap: nothing generates an API to run e2e against, a
 * migration to apply, or a Playwright suite, so the gate was red on a project
 * the generator had just written. A gate that cannot pass on its first run is
 * the one lesson this harness must not teach.
 *
 * Refusing the flags outright would throw away real information — "this
 * project will have a database" shapes the configuration and the files. So the
 * answers shape everything they can, and the steps they imply are *deferred*:
 * named in the output, named in the new project's AGENTS.md, with the exact
 * line to add and what has to exist first.
 */
export function chosenSteps() {
  return STEPS.filter((s) => s.needs === null);
}

/**
 * @param {Pick<Answers, 'database' | 'api' | 'browser'>} answers
 * @returns {DeferredStep[]}
 */
export function deferredSteps({ database, api, browser }) {
  /** @type {Record<string, boolean>} */
  const wanted = { database, api, browser };
  // The reason is per step, not per answer. Two of these wait for different
  // things and one sentence covering both would be wrong about one of them.
  //
  // The e2e reasons name Postgres, and that is not hedging. Both `api_e2e` and
  // `browser_e2e` in verify.sh call `prepare_test_database` before they run a
  // thing, so neither step can be added without a database — including step 05
  // in a project whose UI never touches one. Found on 2026-09-11 by reading
  // the gate rather than by assuming it; a reader who takes "add it when there
  // is a Playwright suite" at face value would add the line and watch the step
  // die on a connection.
  /** @type {Record<string, string>} */
  const because = {
    'api-e2e':
      'add it when a suite calls the API. It also needs Postgres: api_e2e calls prepare_test_database first',
    'browser-e2e':
      'add it when a Playwright suite opens the page. It also needs Postgres: browser_e2e calls prepare_test_database first, whether or not the UI has a database behind it',
    migrations: 'add it when migrations/ holds its first .sql file',
  };
  return STEPS.filter((s) => s.needs !== null && wanted[s.needs] === true).map((s) => ({
    ...s,
    because: because[s.name] ?? '',
  }));
}

/**
 * The gate, with its step list replaced. Everything above the list is copied
 * byte for byte, because that part is the mechanism and is not this project's.
 * @param {string} source
 * @param {Step[]} steps
 */
export function renderVerify(source, steps) {
  const lines = source.split('\n');
  const first = lines.findIndex((l) => /^run_step 01 /u.test(l));
  const last = lines.reduce((at, l, i) => (/^run_step \d\d /u.test(l) ? i : at), -1);
  if (first === -1 || last === -1) {
    throw new Error('verify.sh has no run_step block: this generator cannot rewrite what it cannot find');
  }

  const width = Math.max(...steps.map((s) => s.name.length)) + 1;
  const rendered = steps.map((s) => `run_step ${s.n} ${s.name.padEnd(width)}${s.command}`);

  // Comments interleaved with the steps belong to steps that may be gone, so
  // the whole block is replaced rather than filtered line by line.
  return [...lines.slice(0, first), ...rendered, ...lines.slice(last + 1)].join('\n');
}

/**
 * The files a new project gets: the scripts, and not the suites that fire at
 * them.
 *
 * Both decisions were made by running this rather than by reasoning. Copying
 * only `core` produced a gate whose steps called scripts that were not there,
 * because the tiers differ in whether a file reads `harness.config.json` and
 * not in whether it is copied. Copying the *suites* then failed twelve of them
 * at once: they assert this repository's documents, dependencies and structure,
 * and in an empty project `docs-drift` is checking tables nobody has written.
 *
 * Which is the right answer rather than a concession. A project that adopts a
 * harness should not inherit six hundred assertions about a harness it did not
 * write; those belong beside the harness, in the repository that maintains it.
 * What a new project gets is the mechanisms, and `scripts/__tests__/` empty and
 * waiting for guards of its own.
 * A script the manifest lists under `dependencies.onlyWith` is left out with
 * its dependency: `migrate.mjs` imports `pg`, and in a project with no
 * database the import has nothing to resolve to. That was harmless while the
 * scripts went unchecked and became a red step 02 the day they carried
 * `// @ts-check` — the generate job caught it on the three variants without a
 * database, and the two with one passed.
 * @param {Manifest} manifest
 * @param {Partial<Answers>} [answers]
 */
export function copiedFiles(manifest, answers = {}) {
  const picked = /** @type {Record<string, unknown>} */ (answers);
  const leftOut = new Set(
    Object.entries(manifest.dependencies.onlyWith)
      .filter(([answer]) => answer !== '//' && picked[answer] !== true)
      .flatMap(([, scripts]) => (Array.isArray(scripts) ? scripts : [])),
  );
  return [
    ...manifest.core.scripts,
    ...Object.keys(manifest.configured.scripts),
    ...manifest.elsewhere.core.filter((f) => f !== 'verify.sh'),
  ].filter((f) => !leftOut.has(f));
}

/**
 * Which packages a generated project needs, from the manifest, and at which
 * versions, from this repository's package.json.
 *
 * Never versions in the manifest. The first version of this hardcoded js-yaml
 * ^4 while this repository had ^5, so a new project would have got a different
 * major of the library the copied script was written against. Resolving the
 * name here means the two cannot disagree.
 */
export const VERSIONS_FILE = 'harness.versions.json';

export function versionsAvailable() {
  // Root first, then the applications, because that is where a monorepo keeps
  // the versions of the things only one application uses: React is in
  // apps/web/package.json and nowhere else. That was the whole story while the
  // generator lived inside a product that happened to contain one of
  // everything.
  //
  // This repository is the harness alone, with no API and no page in it, so
  // what the generator writes for --api, --web and --database is resolved from
  // harness.versions.json instead: the versions those templates were written
  // against, recorded once, for exactly the packages no package.json here can
  // give a version for. A name in both is refused rather than resolved from
  // either — two copies of a version drift, which is the reason the manifest
  // records packages and never versions.
  const files = ['package.json', 'apps/api/package.json', 'apps/web/package.json'];
  /** @type {Record<string, string>} */
  const available = {};
  for (const file of files) {
    if (!existsSync(path.join(root, file))) continue;
    const pkg = JSON.parse(read(file));
    Object.assign(available, pkg.dependencies, pkg.devDependencies);
  }
  if (existsSync(path.join(root, VERSIONS_FILE))) {
    /** @type {Record<string, string>} */
    const recorded = JSON.parse(read(VERSIONS_FILE)).versions ?? {};
    const twice = Object.keys(recorded).filter((name) => available[name] !== undefined);
    if (twice.length > 0) {
      throw new Error(
        `${VERSIONS_FILE} records ${twice.join(', ')}, which package.json already gives a version for. ` +
          'One place per version: remove it from the file and let package.json decide.',
      );
    }
    Object.assign(available, recorded);
  }
  return available;
}

/**
 * @param {Manifest} manifest
 * @param {Partial<Answers>} answers
 */
export function dependenciesFor(manifest, answers) {
  const available = versionsAvailable();
  const picked = /** @type {Record<string, unknown>} */ (answers);

  const names = new Set(manifest.dependencies.toolchain.packages);
  const skip = new Set(
    Object.entries(manifest.dependencies.onlyWith)
      .filter(([answer]) => answer !== '//' && picked[answer] !== true)
      .flatMap(([, scripts]) => (Array.isArray(scripts) ? scripts : [])),
  );

  for (const [script, packages] of Object.entries(manifest.dependencies.scripts)) {
    if (script === '//' || skip.has(script) || !Array.isArray(packages)) continue;
    for (const p of packages) names.add(p);
  }

  // What the scaffolded applications need, and only the ones chosen. A project
  // that took neither pays for neither: no React in a repository with no page.
  for (const [group, packages] of Object.entries(manifest.dependencies.apps ?? {})) {
    if (group === '//' || picked[group] !== true || !Array.isArray(packages)) continue;
    for (const p of packages) names.add(p);
  }

  const missing = [...names].filter((n) => available[n] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `harness.manifest.json names ${missing.join(', ')}, which no package.json here can give a version for. ` +
        'A package the manifest records must be one this repository actually uses.',
    );
  }

  /** @type {Record<string, string>} */
  const resolved = {};
  for (const n of [...names].sort()) {
    const version = available[n];
    if (version !== undefined) resolved[n] = version;
  }
  return resolved;
}

/**
 * @param {string} name
 * @param {Answers} answers
 * @param {Record<string, string>} devDependencies
 */
const PACKAGE_JSON = (name, answers, devDependencies) => ({
  name,
  private: true,
  type: 'module',
  // What pnpm/action-setup reads in the copied CI workflow; without it the
  // `verify` job fails before the checkout is even installed, with "No pnpm
  // version is specified". Taken from this repository's package.json, so a
  // new project runs the pnpm the harness was gated with.
  packageManager: JSON.parse(read('package.json')).packageManager,
  scripts: {
    lint: 'eslint .',
    typecheck: 'tsc -b --force tsconfig.build.json',
    'test:unit': 'jest --config jest.config.cjs',
    progress: 'node scripts/progress.mjs',
    verify: './verify.sh',
    prepare: 'git config core.hooksPath .githooks || true',
    ...(answers.database ? { migrate: 'node scripts/migrate.mjs' } : {}),
    ...(answers.api ? { 'dev:api': `pnpm --filter @${name}/api dev` } : {}),
    ...(answers.web ? { 'dev:web': `pnpm --filter @${name}/web dev` } : {}),
    ...(answers.api || answers.web ? { build: 'pnpm -r build' } : {}),
  },
  devDependencies,
});

/**
 * The TypeScript projects, in build order. `packages/core` first because
 * anything else may come to depend on it, and the function last for the reason
 * given where it is written.
 */
/**
 * @param {Answers} answers
 * @param {{ functions: boolean }} options
 */
function projectRefs(answers, { functions }) {
  return [
    { path: './packages/core' },
    ...(answers.api ? [{ path: './apps/api' }] : []),
    ...(answers.web ? [{ path: './apps/web' }] : []),
    ...(answers.api && functions ? [{ path: './tsconfig.functions.json' }] : []),
    // The copied scripts, checked as they are: every one carries `// @ts-check`
    // and JSDoc, and this is what makes the directive more than decoration in
    // a project that did not write them. Last, because it depends on nothing.
    { path: './tsconfig.scripts.json' },
  ];
}

/**
 * A jest project per compiler configuration, which is what the boundaries
 * really are: `apps/api` is CommonJS with decorators, `apps/web` is JSX in a
 * DOM, and neither can be checked by the other's tsconfig.
 */
/** @param {Answers} answers */
function jestProjects(answers) {
  const api = [
    '    {',
    "      displayName: 'api-unit',",
    '      rootDir: __dirname,',
    "      testEnvironment: 'node',",
    "      testMatch: ['<rootDir>/apps/api/src/**/*.spec.ts'],",
    "      transform: { '^.+\\\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/apps/api/tsconfig.json' }] },",
    '    },',
  ];
  const web = [
    '    {',
    "      displayName: 'web-unit',",
    '      rootDir: __dirname,',
    "      testEnvironment: 'jsdom',",
    "      testMatch: ['<rootDir>/apps/web/src/**/*.spec.{ts,tsx}'],",
    "      setupFilesAfterEnv: ['<rootDir>/apps/web/jest.setup.ts'],",
    '      // A real tsconfig inside apps/web rather than an inline one: type',
    '      // packages such as @testing-library/jest-dom resolve from where they',
    '      // are declared, and an inline config is resolved from the root.',
    "      transform: { '^.+\\\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/apps/web/tsconfig.jest.json' }] },",
    '    },',
  ];
  return [...(answers.api ? api : []), ...(answers.web ? web : [])];
}

/** @type {Record<string, (name: string, answers: Answers) => string>} */
const SEEDS = {
  'pnpm-workspace.yaml': (_name, answers) =>
    ['packages:', "  - 'packages/*'", ...(answers.api || answers.web ? ["  - 'apps/*'"] : []), ''].join('\n'),

  '.gitignore': () =>
    ['node_modules/', 'dist/', 'dist-types/', '.generated/', '.env', '.env.local', 'coverage/', '.DS_Store'].join('\n') + '\n',

  '.nvmrc': () => `${process.version.replace('v', '')}\n`,

  'feature_list.json': () => '[]\n',

  // The shape of the file intake gate 5 reads, with no rules in it: a rule
  // this generator wrote would be a rule about a product it has never seen.
  'docs/DOMAIN_RULES.md': (name) =>
    [
      '# Domain rules',
      '',
      `The constraints a spec for ${name} is checked against, at intake gate 5, by`,
      'number. A rule here says what the product promises and what it refuses; an',
      'invariant in `docs/INVARIANTS.md` says what must never change in the',
      'repository. A spec that contradicts a rule is bounced, and a finding that',
      'cites no rule is not a finding.',
      '',
      'Every rule names how a violation would be detected. A rule nobody can check',
      'is a preference, and belongs in a conversation rather than here.',
      '',
      '| # | Rule | Checked by |',
      '|---|---|---|',
      '| R1 | <what the product promises, in one sentence> | <the test, guard or review that catches a violation> |',
      '',
      '## R1 — <the rule, restated as a heading>',
      '',
      '<Why it holds, and what went wrong or would go wrong without it. Then the',
      'exact check, so a reader can run it.>',
      '',
    ].join('\n'),


  'coverage-floor.json': (_name, answers) => {
    const zero = { statements: 0, branches: 0, functions: 0, lines: 0 };
    return (
      JSON.stringify(
        {
          '//': 'The floor only goes up. `check-coverage.mjs --raise` moves it after a green run.',
          areas: {
            './packages/': zero,
            ...(answers.api ? { './apps/api/src/': zero } : {}),
            ...(answers.web ? { './apps/web/src/': zero } : {}),
          },
          unfloored: {},
          // Jest measures what its tests import, so a file nothing imports is
          // invisible to coverage and could never lower a floor. Every source
          // file is therefore either in the report or named here with the
          // reason. These three are the generator's own, and they are the
          // honest cases rather than an exemption: two boot a process and one
          // is wiring.
          unmeasured: {
            ...(answers.api
              ? {
                  'apps/api/src/main.ts': 'process entry point — boots the framework, no logic of its own',
                  'apps/api/src/app.module.ts':
                    'wiring only; exercised whenever an e2e suite boots the app (step 04, once it exists)',
                }
              : {}),
            ...(answers.web
              ? { 'apps/web/src/main.tsx': 'process entry point — mounts React, no logic of its own' }
              : {}),
          },
        },
        null,
        2,
      ) + '\n'
    );
  },

  'tsconfig.base.json': () =>
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noUncheckedIndexedAccess: true,
          declaration: true,
          skipLibCheck: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
        },
      },
      null,
      2,
    ) + '\n',

  'tsconfig.json': (_name, answers) =>
    JSON.stringify({ files: [], references: projectRefs(answers, { functions: false }) }, null, 2) + '\n',

  // `tsconfig.functions.json` is referenced LAST, and the order is load
  // bearing: `api/index.ts` imports the API's build output, so apps/api has to
  // have emitted before anything typechecks the file that consumes it.
  'tsconfig.build.json': (_name, answers) =>
    JSON.stringify({ files: [], references: projectRefs(answers, { functions: true }) }, null, 2) + '\n',

  'eslint.config.mjs': () =>
    [
      "import tseslint from 'typescript-eslint';",
      '',
      '// The layer rules go here. This one only asks that the code compiles under',
      '// the recommended set; a project adds its own boundaries and a suite that',
      '// fires at them, which is the third part of every guard.',
      'export default tseslint.config(',
      "  { ignores: ['**/dist/**', '**/dist-types/**', '**/node_modules/**', '.generated/**'] },",
      '  ...tseslint.configs.recommended,',
      '  {',
      '    rules: {',
      '      // The copied guard suites use `_name` for arguments they must accept',
      "      // and will not read. Without this the gate is red on its first run,",
      '      // on files the generator itself wrote.',
      "      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],",
      '    },',
      '  },',
      ');',
      '',
    ].join('\n'),

  'jest.config.cjs': (_name, answers) =>
    [
      "/** Two projects: the product, and the guards that fire at the harness. */",
      'module.exports = {',
      '  // At the root, not in a project: jest refuses it there. The platform',
      '  // project starts empty, and an empty project must not be a red gate.',
      '  passWithNoTests: true,',
      '  // Every case by name, into the run\'s 03-unit.log, where the spec-auditor',
      '  // looks for the assertion a contract names; a tally locates nothing. The',
      '  // reporter is explicit because Jest 30 without it prints neither PASS',
      '  // lines nor case names, whatever `verbose` says.',
      '  verbose: true,',
      "  reporters: ['default'],",
      '  collectCoverage: true,',
      '  // Into the run\'s own evidence folder when the gate is driving, so a',
      "  // run's coverage is filed with the rest of what it produced and step 08",
      '  // can find it. Anywhere else and the gate is red for a reason that has',
      '  // nothing to do with the code.',
      '  coverageDirectory: process.env.EVIDENCE_DIR',
      "    ? `${process.env.EVIDENCE_DIR}/coverage`",
      "    : '.generated/coverage',",
      "  coverageReporters: ['json-summary', 'text-summary'],",
      // Only while there is one compiler configuration. A root-level
      // collectCoverageFrom applies to every project, so each instruments the
      // others' files with its own tsconfig — and apps/api's has a rootDir of
      // `src`, which makes every packages/ file handed to it a TS6059. Without
      // it Jest measures what the tests import, and check-coverage.mjs is what
      // refuses a file nothing imports.
      ...(answers.api || answers.web
        ? []
        : ["  collectCoverageFrom: ['packages/*/src/**/*.ts', '!**/*.spec.ts'],"]),
      '  projects: [',
      '    {',
      "      displayName: 'unit',",
      '      rootDir: __dirname,',
      "      testEnvironment: 'node',",
      "      testMatch: ['<rootDir>/packages/*/src/**/*.spec.ts'],",
      '      // NodeNext wants the `.js` specifier in source; ts-jest compiles to',
      '      // CommonJS and cannot resolve it. Mapping it back is what lets one',
      '      // set of files satisfy both.',
      "      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },",
      "      transform: { '^.+\\\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }] },",
      '    },',
      '    {',
      "      displayName: 'platform',",
      '      rootDir: __dirname,',
      "      testEnvironment: 'node',",
      "      testMatch: ['<rootDir>/scripts/__tests__/**/*.spec.ts'],",
      '      // Empty until this project writes guards of its own. The harness',
      "      // brings the mechanisms; the assertions about them live with the",
      '      // harness, not in every project that adopts it.',
      "      transform: { '^.+\\\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }] },",
      '    },',
      ...jestProjects(answers),
      '  ],',
      '};',
      '',
    ].join('\n'),

  'packages/core/package.json': (name) =>
    JSON.stringify({ name: `@${name}/core`, version: '0.1.0', private: true, type: 'module' }, null, 2) + '\n',

  'packages/core/tsconfig.json': () =>
    JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: { outDir: 'dist', rootDir: 'src', composite: true, tsBuildInfoFile: 'dist/.tsbuildinfo', types: ['node', 'jest'] },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ) + '\n',

  'packages/core/src/index.ts': () =>
    [
      '/**',
      ' * The first guarantee, so the gate has something to verify on its first run.',
      ' * Replace it with the real one; keep the shape — a function, and a test that',
      ' * would fail if the function were wrong.',
      ' */',
      'export function greet(name: string): string {',
      "  if (name.trim() === '') throw new Error('greet needs a name');",
      '  return `Hello, ${name}.`;',
      '}',
      '',
    ].join('\n'),

  'packages/core/src/index.spec.ts': () =>
    [
      "import { greet } from './index.js';",
      '',
      "describe('greet', () => {",
      "  it('greets by name', () => {",
      "    expect(greet('world')).toBe('Hello, world.');",
      '  });',
      '',
      "  it('refuses an empty name rather than greeting nobody', () => {",
      "    expect(() => greet('   ')).toThrow(/needs a name/u);",
      '  });',
      '});',
      '',
    ].join('\n'),
};

/** @param {string} name */
const PROGRESS_SEED = (name) =>
  [
    '# Progress',
    '',
    'Newest at the bottom. What closed, the evidence, and the reasons — not the diff.',
    '`node scripts/progress.mjs template` prints the shape.',
    '',
    `## ${new Date().toISOString().slice(0, 10)} — ${name} starts, with the gate already in it`,
    '',
    '- **Feature**: none yet',
    '- **Result**: passing',
    '- **Verified by**: `./verify.sh`, on the tree the generator wrote',
    '- **Evidence**: none yet — the first `./verify.sh` writes the first `verify-log/<id>`; every later entry names one',
    '- **Contract changes**: none.',
    '- **Notes**:',
    '',
    '  Generated by `harness-init.mjs`. The gate is green on an empty project,',
    '  which is the only starting point from which a red gate means something.',
    '',
  ].join('\n');

/** @param {Answers} answers */
export function configFor(answers) {
  return {
    '//': 'What the harness knows about this project. Edit this rather than the scripts.',
    coverage: { sources: ['packages', ...(answers.api || answers.web ? ['apps'] : [])] },
    database: { required: answers.database, testSuffix: '_test', exampleName: `${answers.name}_test` },
    migrations: { directory: 'migrations' },
    verifyProbe: { path: 'packages/core/src/__verify_probe.ts' },
    ports: { api: 3100, web: 5273 },
    // Where a reviewer looks first, and what triggers the security subagent.
    // Everything named here takes input from outside: the controllers, the
    // schema, and the two files that decide which request reaches what.
    attackSurface: {
      paths: [
        ...(answers.database ? ['migrations/'] : []),
        ...(answers.api ? ['apps/api/src/controller/', 'api/', 'vercel.json'] : []),
      ],
    },
    contracts: { package: null },
    // Commits allowed to close more than one entry, because they predate the
    // rule. A new project has none.
    featureList: { exemptCommits: [] },
    // Tool calls a session may make between two messages before the budget
    // hook asks it to stop; where /task-intake reads specs from, or null for
    // the inbox alone.
    session: { workBudget: 30 },
    intake: { notion: null },
  };
}

/** @param {Answers} answers */
export function plan(answers) {
  /** @type {Manifest} */
  const manifest = JSON.parse(read('harness.manifest.json'));
  return {
    steps: chosenSteps(),
    deferred: deferredSteps(answers),
    dependencies: dependenciesFor(manifest, answers),
    copied: copiedFiles(manifest, answers),
    generated: [
      ...Object.keys(SEEDS),
      'verify.sh',
      'harness.config.json',
      'PROGRESS.md',
      'AGENTS.md',
      'CLAUDE.md',
      ...(answers.api ? Object.keys(API) : []),
      ...(answers.web ? Object.keys(WEB) : []),
      ...(answers.api || answers.web ? ['vercel.json'] : []),
      ...(answers.mcp.length > 0 ? ['.mcp.json'] : []),
      ...(answers.database ? ['docker-compose.yml', 'migrations/README.md'] : []),
    ].sort(),
  };
}

/**
 * @param {string} into
 * @param {string} rel
 * @param {string} contents
 */
function write(into, rel, contents) {
  const target = path.join(into, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/**
 * @param {string} into
 * @param {Answers} answers
 */
export function scaffold(into, answers) {
  const { steps, deferred, copied } = plan(answers);

  if (existsSync(into) && execFileSync('ls', ['-A', into], { encoding: 'utf8' }).trim() !== '') {
    throw new Error(`${into} is not empty. This writes a new project; it does not merge into one.`);
  }
  mkdirSync(into, { recursive: true });

  for (const rel of copied) {
    const from = path.join(root, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(path.join(into, rel)), { recursive: true });
    cpSync(from, path.join(into, rel));
  }

  write(into, 'verify.sh', renderVerify(read('verify.sh'), steps));
  execFileSync('chmod', ['+x', path.join(into, 'verify.sh')]);

  write(into, 'harness.config.json', `${JSON.stringify(configFor(answers), null, 2)}\n`);
  /** @type {Manifest} */
  const manifest = JSON.parse(read('harness.manifest.json'));
  write(
    into,
    'package.json',
    `${JSON.stringify(PACKAGE_JSON(answers.name, answers, dependenciesFor(manifest, answers)), null, 2)}\n`,
  );
  write(into, 'PROGRESS.md', PROGRESS_SEED(answers.name));

  for (const [rel, make] of Object.entries(SEEDS)) write(into, rel, make(answers.name, answers));

  // The applications, and the platform configuration that routes to them.
  if (answers.api) for (const [rel, make] of Object.entries(API)) write(into, rel, make(answers.name));
  if (answers.web) for (const [rel, make] of Object.entries(WEB)) write(into, rel, make(answers.name));
  if (answers.api || answers.web) write(into, 'vercel.json', vercelConfig({ ...answers }));

  // Declared, not connected: each server is authorised once by a person, and
  // until then its tools are absent rather than broken.
  if (answers.mcp.length > 0) write(into, '.mcp.json', mcpConfig(answers.mcp));

  // The two documents an agent reads first. Seeded rather than copied: this
  // project's carry its own history, and a new project inheriting somebody
  // else's incidents is worse than starting with none.
  write(into, 'AGENTS.md', agentsSeed(answers, steps, deferred));
  write(into, 'CLAUDE.md', claudeSeed(answers.name));

  if (answers.database) {
    write(into, 'docker-compose.yml', DOCKER_COMPOSE(answers.name));
    write(into, 'migrations/README.md', MIGRATIONS_README);
  }

  return { steps, deferred, copied };
}

/** @param {string} name */
const DOCKER_COMPOSE = (name) =>
  [
    '# Postgres for the gate, and for `pnpm dev`. One container, several',
    '# databases inside it: the gate uses a disposable one whose name ends in',
    '# `_test`, which is the whole of what keeps `migrate.mjs --yes` off a real',
    '# database.',
    'services:',
    '  postgres:',
    '    image: postgres:17-alpine',
    `    container_name: ${name}-pg`,
    '    environment:',
    `      POSTGRES_USER: ${name}`,
    `      POSTGRES_PASSWORD: ${name}`,
    `      POSTGRES_DB: ${name}`,
    '    ports:',
    "      - '5433:5432'",
    '    volumes:',
    `      - ${name}-pgdata:/var/lib/postgresql/data`,
    '    healthcheck:',
    '      # -h forces TCP. The initdb bootstrap server answers on the unix',
    '      # socket too, so a socket check reports healthy before the real',
    '      # server exists.',
    `      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U ${name}']`,
    '      interval: 2s',
    '      retries: 30',
    '',
    'volumes:',
    `  ${name}-pgdata:`,
    '',
  ].join('\n');

const MIGRATIONS_README = [
  '# Migrations',
  '',
  'Plain `.sql`, applied in filename order by `scripts/migrate.mjs`. Numbered',
  'from `001_`, and never edited once applied: a change is a new file.',
  '',
  '`--yes` is honoured only for a database whose name ends in `_test` (see',
  '`harness.config.json`). Everything else waits for a person to answer.',
  '',
  'Add the first one, then add step 09 to `verify.sh`:',
  '',
  '```',
  'run_step 09 migrations  node scripts/check-migrations.mjs',
  '```',
  '',
].join('\n');

/** What each deferred step is waiting on, in the words its answer was given in. */
/** @type {Record<string, string>} */
const NEEDS = { database: 'a database', api: 'an API', browser: 'a browser UI' };

/**
 * @param {Answers} answers
 * @param {Step[]} steps
 * @param {DeferredStep[]} deferred
 */
const agentsSeed = (answers, steps, deferred) =>
  [
    '# AGENTS.md',
    '',
    `Read this before changing anything in ${answers.name}. It is written for any`,
    'agent, not one in particular.',
    '',
    '## The rules',
    '',
    `**1. The gate decides, not you.** \`./verify.sh\` is ${steps.length} steps and the only`,
    'thing that establishes the code works. A red gate is fixed, never worked around.',
    '',
    '**2. A commit carries a tree the gate has passed.** The receipt records a hash',
    'of the working tree — the journal excepted, which the gate reads on its own —',
    'so any edit after a green run invalidates it.',
    '',
    '**3. Claims are earned, not asserted.** `feature_list.json` is a list of',
    "guarantees; an entry's `passes` is `true` only on evidence, one closure per",
    'commit — opened and closed in the same commit when the work is small — and a',
    'closing commit needs an independent audit saying READY.',
    '',
    '**4. Work reaches `main` through a pull request.** Branch first, not after.',
    'A branch under `spike/` is exploration: no receipt, no journal, no contract,',
    'no audit — and no pull request. What survives is rebuilt on a branch of its',
    'own (I16).',
    '',
    '**5. Anything underspecified is a question, not a guess.**',
    '',
    '**6. Measure before you conclude.** Reading a script tells you what it was',
    'meant to do.',
    '',
    '**7. Secrets never enter the session.** `.env` is not read, printed or copied.',
    '',
    '## What refuses what',
    '',
    '| Mechanism | Refuses |',
    '|---|---|',
    '| `./verify.sh` step 06 | two entries closed in one commit, or a rewritten one |',
    '| the commit gate | a commit whose tree no green run covers, a closure without its READY audit, a journal entry a reader cannot follow |',
    '| protected-file guard | a session edit to `verify.sh`, the CI workflow, or `.claude/settings.json` |',
    '| `spike.mjs`, in the gate, the hooks and CI | nothing on a `spike/*` branch; and a pull request from one |',
    '| append-only guards | a run under `verify-log/` or an audit under `audit-log/` edited or removed, or a rewritten line in `feature_list.json` |',
    '',
    'Write a patch under `.generated/scratch/` for a protected file and ask a person',
    'to apply it.',
    '',
    '## What to fill in',
    '',
    'This file was generated. `docs/INVARIANTS.md` came with the harness and',
    'holds what the gate already enforces, under the numbers the scripts cite;',
    'yours go below its line, from I17. Two things are yours to write, and the',
    'harness is worth less until they exist:',
    '',
    '- `docs/DOMAIN_RULES.md` — the constraints a spec is checked against; the',
    '  file is a template with the shape and no rules',
    '- the coverage floor: `node scripts/check-coverage.mjs --raise` after the',
    '  first green run, so it starts where the project starts and not at zero',
    '- the layer rules in `eslint.config.mjs`, and a suite that fires at them',
    '',
    ...(answers.mcp.length === 0
      ? []
      : [
          '## MCP servers',
          '',
          '`.mcp.json` declares these. Declared is not connected: each is authorised',
          'once, by a person, and until then its tools are absent rather than broken.',
          '',
          ...answers.mcp.map((n) => `- **${n}** — ${MCP[n]?.why ?? ''}`),
          '',
          'A server whose purpose you cannot state is a tool call you should not make.',
          'Adding one is a change to this list as much as to the JSON.',
          '',
        ]),
    ...(deferred.length === 0
      ? []
      : [
          '## Steps this gate does not have yet',
          '',
          'You said this project will have ' +
            [...new Set(deferred.map((s) => NEEDS[String(s.needs)] ?? String(s.needs)))].join(' and ') +
            ', and the generator wrote what it could for',
          'that. These steps are not in `verify.sh`, because nothing here can pass',
          'them yet, and a gate that cannot pass is one people learn to run with',
          '`|| true`.',
          '',
          'Add each line when the thing it checks exists:',
          '',
          '```',
          ...deferred.map((s) => `run_step ${s.n} ${s.name}  ${s.command}   # ${s.because}`),
          '```',
          '',
          ...(deferred.some((s) => s.command === 'api_e2e' || s.command === 'browser_e2e')
            ? [
                'The e2e steps call shell functions that are already in `verify.sh`',
                'above the step list, waiting for a suite to run. The database ones',
                'also need `docker-compose.yml`, which was generated beside this file.',
                '',
              ]
            : []),
        ]),
  ].join('\n');

/** @param {string} name */
const claudeSeed = (name) =>
  [
    '# Claude Code in this repository',
    '',
    '**Read [AGENTS.md](AGENTS.md) first.** It holds what this project is and the',
    'rules, for any agent. This file carries only what is specific to Claude Code.',
    '',
    '## Session-start ritual',
    '',
    '1. `git log --oneline -20`, and read the newest entries of `PROGRESS.md`.',
    '2. Read `feature_list.json` and pick **one** entry that is not done.',
    '',
    '## Hooks',
    '',
    'Configured in `.claude/settings.json`: the commit gate and the work budget',
    'before a tool call, the protected-file comparison after one, and a check at',
    'the end of a session that the journal was written and nothing is invisible to CI.',
    '',
    '## Skills',
    '',
    '`/setup-repo`, `/task-intake`, `/verify-task`, `/open-pr`, `/review-pr`,',
    '`/address-comments`. Each says what it refuses and why.',
    '',
    `## Definition of done in ${name}`,
    '',
    'A contract in `specs/`, `./verify.sh` green, `passes` flipped, an entry in',
    '`PROGRESS.md`, a commit, and a merged pull request.',
    '',
  ].join('\n');

/**
 * One list of parts, chosen by number, rather than a yes/no per part.
 *
 * Flags were the first interface and they were the wrong one: a person running
 * this has not read the file, so `--database --browser` is a list they cannot
 * see and cannot be told the consequences of. A numbered list can say, beside
 * each line, what choosing it puts in the repository — and what it does not,
 * which is the half that matters here, because two of these defer a gate step
 * rather than adding one.
 *
 * The flags still exist, for `--yes`: CI and the test suite need a way to ask
 * for a project without a terminal.
 */
export const PARTS = [
  {
    key: 'database',
    label: 'a database, with migrations',
    detail: 'docker-compose.yml, migrations/, and migrate.mjs. Step 09 waits for the first .sql file.',
  },
  {
    key: 'api',
    label: 'an HTTP API on NestJS, deployed as one serverless function',
    detail: 'apps/api, api/index.ts and vercel.json, with four tests already passing. Step 04 waits for an e2e suite.',
  },
  {
    key: 'web',
    label: 'a browser UI on React, built by Vite',
    detail: 'apps/web with a page and two tests. Step 05 waits for a Playwright suite.',
  },
];

/**
 * Numbers from a line, refused rather than guessed at.
 *
 * A typo used to be read as a silent "none", so `2, 3` — one stray space away
 * from what a person meant — produced an empty project that looked like the
 * one they asked for. Anything that is not a number in range is now an error
 * with the offending token in it.
 */
/**
 * @param {string} line
 * @param {number} count
 * @returns {number[]}
 */
export function parseChoice(line, count) {
  const tokens = line.split(/[\s,]+/u).filter((t) => t !== '');
  /** @type {Set<number>} */
  const chosen = new Set();
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1 || n > count) {
      throw new Error(`"${token}" is not one of the numbers above (1-${count}).`);
    }
    chosen.add(n - 1);
  }
  return [...chosen].sort((a, b) => a - b);
}

/** @returns {Promise<Answers>} */
async function ask() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  /**
   * @param {string} text
   * @param {string} fallback
   */
  const question = async (text, fallback) => {
    const answer = (await rl.question(`${text} `)).trim();
    return answer === '' ? fallback : answer;
  };

  /** Asks until the line parses. A refusal that ends the run would lose the name. */
  /**
   * @template T
   * @param {T[]} items
   * @param {(n: number, item: T) => string} render
   * @returns {Promise<number[]>}
   */
  const choose = async (items, render) => {
    for (const [i, item] of items.entries()) console.log(render(i + 1, item));
    console.log('');
    for (;;) {
      try {
        return parseChoice(await question('  numbers, blank for none:', ''), items.length);
      } catch (error) {
        console.log(`  ${error instanceof Error ? error.message : String(error)} Try again.`);
      }
    }
  };

  const name = await question('Project name:', 'my-project');

  console.log('');
  console.log('What is in it? This decides which gate steps the project gets. A step');
  console.log('whose requirement does not exist is left out rather than shipped broken,');
  console.log('and named in AGENTS.md with the line to add once it can pass.');
  console.log('');
  const parts = await choose(PARTS, (n, p) => `  ${n}  ${p.label}\n       ${p.detail}`);
  const chosen = Object.fromEntries(PARTS.map((p, i) => [p.key, parts.includes(i)]));

  console.log('');
  console.log('MCP servers for agents working here. Declaring one does not connect it:');
  console.log('a person authorises each once, and until then its tools are absent.');
  console.log('');
  const names = Object.keys(MCP);
  const mcp = await choose(names, (n, key) => `  ${n}  ${key.padEnd(9)}${MCP[key]?.why ?? ''}`);

  rl.close();
  return {
    name,
    database: chosen.database === true,
    api: chosen.api === true,
    web: chosen.web === true,
    // A React page is a browser UI, so it is what step 05 is waiting for.
    // `--browser` stays separately settable for a project whose UI this
    // generator did not write.
    browser: chosen.web === true,
    mcp: mcp.flatMap((i) => {
      const key = names[i];
      return key === undefined ? [] : [key];
    }),
  };
}

/**
 * The command, exported so the package's `bin` can call it without spawning a
 * second node. `main` stays the name the file runs itself under.
 */
export async function cli() {
  return main();
}

async function main() {
  const args = process.argv.slice(2);
  /**
   * @param {string} key
   * @param {string} fallback
   */
  const flag = (key, fallback) => {
    const i = args.indexOf(`--${key}`);
    return i === -1 ? fallback : (args[i + 1] ?? fallback);
  };

  // `--yes` is the non-interactive path, for CI and for the suite that runs
  // this a dozen times. A person gets the list in ask().
  /** @type {Answers} */
  const answers = args.includes('--yes')
    ? {
        name: flag('name', 'my-project'),
        database: args.includes('--database'),
        api: args.includes('--api'),
        web: args.includes('--web'),
        browser: args.includes('--browser') || args.includes('--web'),
        mcp: flag('mcp', '').split(',').filter((n) => n !== ''),
      }
    : await ask();

  const unknown = answers.mcp.filter((n) => MCP[n] === undefined);
  if (unknown.length > 0) {
    throw new Error(`unknown MCP server(s): ${unknown.join(', ')}. Known: ${Object.keys(MCP).join(', ')}.`);
  }

  const into = path.resolve(flag('into', `../${answers.name}`));

  if (args.includes('--plan')) {
    const p = plan(answers);
    console.log(JSON.stringify({ into, answers, ...p }, null, 2));
    return;
  }

  const { steps, deferred, copied } = scaffold(into, answers);

  console.log('');
  console.log(`Wrote ${answers.name} to ${into}`);
  console.log(`  ${copied.length} harness files copied, ${steps.length} gate steps: ${steps.map((s) => s.name).join(', ')}`);
  const built = [answers.api ? 'apps/api' : null, answers.web ? 'apps/web' : null].filter(Boolean);
  if (built.length > 0) console.log(`  ${built.join(' and ')}, with tests that already pass`);
  if (answers.mcp.length > 0) console.log(`  .mcp.json declares ${answers.mcp.join(', ')} — authorise each once`);
  if (deferred.length > 0) {
    console.log('');
    console.log(`  ${deferred.length} step(s) deferred, because nothing here can pass them yet:`);
    for (const s of deferred) console.log(`    ${s.name.padEnd(13)} ${s.because}`);
    console.log('    AGENTS.md carries the line to add for each, and what has to exist first.');
  }
  console.log('');
  console.log('Next, and in this order:');
  console.log(`  cd ${into}`);
  console.log('  git init && pnpm install');
  console.log('  ./verify.sh          # green on an empty project, which is the point');
  console.log('  git add -A && git commit -m "chore: the harness, before anything it guards"');
  console.log('  node scripts/check-coverage.mjs --raise   # the floor starts where you start, not at zero');
  console.log('');
  console.log('Then fill in docs/DOMAIN_RULES.md, and add your own invariants below the');
  console.log("harness's in docs/INVARIANTS.md. Until those exist the gate checks that the");
  console.log('code compiles and that its own mechanisms hold, and little else.');
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
