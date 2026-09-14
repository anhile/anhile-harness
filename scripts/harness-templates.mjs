#!/usr/bin/env node
// @ts-check
/**
 * The applications a generated project can start from, and the MCP servers it
 * can talk to.
 *
 * Kept out of `harness-init.mjs` because that file is the generator's logic and
 * this one is its output. Mixing them put the decisions among four hundred
 * string literals, where nobody would find them. The source files themselves
 * are under `templates/`, one directory per variant, at the path they take in
 * the project; this module says which travel and builds the JSON ones, whose
 * comments are worth more as code than as a file with `//` keys.
 *
 * Two rules held while writing these.
 *
 * **The smallest thing that is real.** One route, one page, and a test that
 * would fail if either were wrong. A scaffold that generates plausible code
 * with no test teaches the opposite of what the rest of the harness is for.
 *
 * **Shaped by what this repository already paid for.** The serverless handler,
 * the `__p` rewrite and the import of the API's build output are not design
 * preferences: each one is a production failure that reached a deployment past
 * a green gate. Their comments say which. A scaffold whose only advantage is
 * saving twenty minutes of typing is not worth maintaining; one that starts a
 * project past four known failures is.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

/**
 * Where the source files live: `templates/<variant>/<path in the project>`.
 * Real files, with their own extension, so an editor highlights them, eslint
 * reads them and a diff shows a changed line rather than a changed string.
 * Until 0.1.3 each was an array of quoted lines in this module, which was
 * the one form no tool could read.
 */
export const TEMPLATES = path.join(root, 'templates');

/** The one token a template carries: the project's name, as the person typed it. */
export const NAME_TOKEN = '__PROJECT_NAME__';

/**
 * A template read from disk, with the project's name put in. Refuses a file
 * that is not there, by path, because the alternative is a project written
 * with a hole in it and a gate that finds the hole later.
 * @param {'api' | 'web'} variant
 * @param {string} rel
 * @returns {(name: string) => string}
 */
export function fromFile(variant, rel) {
  return (name) => {
    const file = path.join(TEMPLATES, variant, rel);
    if (!existsSync(file)) {
      throw new Error(`template missing: ${path.relative(root, file)} — this package is incomplete`);
    }
    return readFileSync(file, 'utf8').replaceAll(NAME_TOKEN, name);
  };
}

/**
 * A NestJS API deployed as a single serverless function.
 *
 * Three files carry a scar, and the comments name it rather than leaving the
 * next person to rediscover it:
 *
 * - `api/index.ts` imports the API's **build output**, never its source
 * - the path arrives in `__p`, because catch-all routing matched one segment
 * - a failed boot is forgotten, or one bad second poisons a warm instance
 */
/** @type {Record<string, (name: string) => string>} */
export const API = {
  'apps/api/package.json': (name) =>
    JSON.stringify(
      {
        name: `@${name}/api`,
        version: '0.1.0',
        private: true,
        main: 'dist/main.js',
        // No dependencies here. The generated project keeps one list of
        // versions, in the root package.json, so that two files cannot
        // disagree about which major of Nest this code was written against.
        scripts: {
          dev: 'node --watch -r ts-node/register src/main.ts',
          build: 'tsc -b',
          start: 'node dist/main.js',
        },
      },
      null,
      2,
    ) + '\n',

  'apps/api/tsconfig.json': () =>
    JSON.stringify(
      {
        '//': [
          'CommonJS, against a base that is NodeNext, and both overrides are load bearing.',
          'Nest is built on legacy decorators, which need experimentalDecorators; under',
          'standard ES decorators every controller dies at import with "Cannot read',
          'properties of undefined (reading value)" — on a build that succeeded.',
        ].join(' '),
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'commonjs',
          moduleResolution: 'node',
          rootDir: 'src',
          outDir: 'dist',
          composite: true,
          tsBuildInfoFile: 'dist/.tsbuildinfo',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          types: ['node', 'jest'],
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ) + '\n',

  'apps/api/src/config/serverless.ts': fromFile('api', 'apps/api/src/config/serverless.ts'),

  'apps/api/src/config/serverless.spec.ts': fromFile('api', 'apps/api/src/config/serverless.spec.ts'),

  'apps/api/src/controller/health.controller.ts': fromFile('api', 'apps/api/src/controller/health.controller.ts'),

  'apps/api/src/controller/health.controller.spec.ts': fromFile('api', 'apps/api/src/controller/health.controller.spec.ts'),

  'apps/api/src/app.module.ts': fromFile('api', 'apps/api/src/app.module.ts'),

  'apps/api/src/main.ts': fromFile('api', 'apps/api/src/main.ts'),

  'api/index.ts': fromFile('api', 'api/index.ts'),

  'tsconfig.functions.json': () =>
    JSON.stringify(
      {
        '//': [
          'The function is the one file that runs in production, and without this it',
          'would be the one file nothing typechecks: tsconfig.build.json references the',
          'workspace projects, and api/ is in none of them. Its own project because it',
          "sits outside apps/api's rootDir and imports that package's build output.",
        ].join(' '),
        extends: './tsconfig.base.json',
        compilerOptions: {
          // CommonJS, overriding the base, because that is what this file
          // consumes: apps/api emits CommonJS, and under the base's NodeNext
          // the import cannot resolve — a directory import finds nothing and
          // every relative path wants an explicit `.js`. Checking it the way
          // the platform builds it is the only check worth having.
          module: 'commonjs',
          moduleResolution: 'node',
          noEmit: true,
          composite: false,
          types: ['node'],
        },
        include: ['api/**/*.ts'],
      },
      null,
      2,
    ) + '\n',
};

/** A React page, built by Vite, and one assertion about what a person sees. */
/** @type {Record<string, (name: string) => string>} */
export const WEB = {
  'apps/web/package.json': (name) =>
    JSON.stringify(
      {
        name: `@${name}/web`,
        version: '0.1.0',
        private: true,
        type: 'module',
        // No dependencies here either; see apps/api/package.json.
        scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      },
      null,
      2,
    ) + '\n',

  'apps/web/tsconfig.json': () =>
    JSON.stringify(
      {
        '//': [
          'Bundler resolution, because Vite resolves the imports and tsc only checks them.',
          'Declarations only: the JavaScript comes from Vite, and emitting a second copy',
          'from tsc would put two builds of the same page in the repository.',
        ].join(' '),
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          rootDir: 'src',
          outDir: 'dist-types',
          composite: true,
          emitDeclarationOnly: true,
          tsBuildInfoFile: 'dist-types/.tsbuildinfo',
          types: ['vite/client', 'jest', '@testing-library/jest-dom'],
        },
        include: ['src/**/*.ts', 'src/**/*.tsx'],
      },
      null,
      2,
    ) + '\n',

  'apps/web/tsconfig.jest.json': () =>
    JSON.stringify(
      {
        '//': 'A real file rather than an inline config, so that the jest-dom types resolve from where they are installed.',
        extends: './tsconfig.json',
        compilerOptions: {
          module: 'commonjs',
          moduleResolution: 'node',
          composite: false,
          declaration: false,
          emitDeclarationOnly: false,
          noEmit: true,
          types: ['jest', 'node', '@testing-library/jest-dom'],
        },
      },
      null,
      2,
    ) + '\n',

  'apps/web/jest.setup.ts': () => "import '@testing-library/jest-dom';\n",

  'apps/web/vite.config.ts': fromFile('web', 'apps/web/vite.config.ts'),

  'apps/web/index.html': fromFile('web', 'apps/web/index.html'),

  'apps/web/src/main.tsx': fromFile('web', 'apps/web/src/main.tsx'),

  'apps/web/src/Home.tsx': fromFile('web', 'apps/web/src/Home.tsx'),

  'apps/web/src/Home.spec.tsx': fromFile('web', 'apps/web/src/Home.spec.tsx'),
};

/**
 * `vercel.json`, which differs by what the project has: the API needs the `__p`
 * rewrite, the web needs everything else served as the single page.
 *
 * The `__p` indirection looks perverse and is the only thing that works. A
 * catch-all file matched exactly one segment however it was declared, so
 * `/api/links` reached the application and `/api/links/{code}/stats` returned
 * the platform's own 404 — one endpoint unreachable while everything shallower
 * worked. Putting the intended path in a query parameter makes depth stop
 * meaning anything.
 */
/** @param {{ api: boolean, web: boolean, name: string }} answers */
export function vercelConfig({ api, web, name }) {
  /**
   * @type {{
   *   $schema: string,
   *   framework?: string,
   *   outputDirectory?: string,
   *   buildCommand?: string,
   *   installCommand?: string,
   *   functions?: Record<string, { maxDuration: number }>,
   *   rewrites?: { source: string, destination: string }[],
   * }}
   */
  const config = { $schema: 'https://openapi.vercel.sh/vercel.json' };

  if (web) {
    config.framework = 'vite';
    config.outputDirectory = 'apps/web/dist';
  }
  config.buildCommand = [
    ...(api ? [`pnpm --filter @${name}/api build`] : []),
    ...(web ? [`pnpm --filter @${name}/web build`] : []),
  ].join(' && ');
  config.installCommand = 'pnpm install --frozen-lockfile';

  if (api) config.functions = { 'api/**': { maxDuration: 15 } };

  config.rewrites = [
    ...(api ? [{ source: '/api/(.*)', destination: '/api?__p=/$1' }] : []),
    ...(web ? [{ source: '/((?!api/).*)', destination: '/index.html' }] : []),
  ];

  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * MCP servers a project can declare, written to `.mcp.json` — where Claude Code
 * reads project-level servers from.
 *
 * Being in the file does not mean connected: each is authorised once, by a
 * person, and until then its tools are absent rather than broken. Notion and
 * Vercel use OAuth and will prompt; Context7 does not.
 *
 * `why` is not decoration. An MCP server whose purpose nobody can state is a
 * tool call nobody should make, so the reason travels into the new project's
 * AGENTS.md rather than staying here. `.mcp.json` itself is left strictly to
 * the schema — a comment key in a file a client validates is a file that stops
 * loading.
 */
/** @type {Record<string, { url: string, why: string }>} */
export const MCP = {
  context7: {
    url: 'https://mcp.context7.com/mcp',
    why: 'Current documentation for a library, by name. Read it before writing against an API from memory — that is rule 6 with a tool attached.',
  },
  notion: {
    url: 'https://mcp.notion.com/mcp',
    why: 'Where feature specs live. `/task-intake` reads a row and refuses anything that is not one.',
  },
  vercel: {
    url: 'https://mcp.vercel.com',
    why: 'Deployments, logs and projects — for reading what production did. Deploying is still a person\'s decision.',
  },
};

/** @param {string[]} chosen */
export function mcpConfig(chosen) {
  return (
    JSON.stringify(
      {
        mcpServers: Object.fromEntries(
          chosen.map((n) => {
            const server = MCP[n];
            // The CLI refuses an unknown name before this runs; this is the
            // same refusal for a caller that did not go through the CLI.
            if (server === undefined) throw new Error(`unknown MCP server: ${n}`);
            return [n, { type: 'http', url: server.url }];
          }),
        ),
      },
      null,
      2,
    ) + '\n'
  );
}
