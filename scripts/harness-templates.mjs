#!/usr/bin/env node
// @ts-check
/**
 * The applications a generated project can start from, and the MCP servers it
 * can talk to.
 *
 * Kept out of `harness-init.mjs` because that file is the generator's logic and
 * this one is its output. Mixing them put the decisions among four hundred
 * string literals, where nobody would find them.
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

  'apps/api/src/config/serverless.ts': () =>
    [
      "import type { IncomingMessage, ServerResponse } from 'node:http';",
      '',
      '/**',
      " * The serverless entry point's logic, minus the framework.",
      ' *',
      ' * It lives here rather than in `api/index.ts` so that it can be tested.',
      ' * That file cannot be: the platform compiles it, it imports the API\'s build',
      ' * output, and Jest reaches neither.',
      ' *',
      ' * Three behaviours, and the first is why this exists as a unit rather than',
      ' * as four lines in the entry point.',
      ' *',
      ' * **A failed boot is forgotten.** `started ??= boot()` remembers the',
      ' * rejected promise: one second of an unreachable database at the wrong',
      ' * moment, and every later request to that instance fails with the same',
      ' * stale error until the platform recycles it.',
      ' *',
      ' * **A successful boot is kept.** One instance serves many invocations, and',
      " * rebuilding the framework per request puts its whole start-up on every",
      ' * request\'s hot path.',
      ' *',
      ' * **Only the attempt that failed is cleared.** Two concurrent requests can',
      ' * await the same rejected promise, and the second must not throw away a',
      ' * fresh boot the first already started.',
      ' */',
      'export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;',
      '',
      'export function createServerlessHandler(',
      '  boot: () => Promise<RequestListener>,',
      '): (req: IncomingMessage, res: ServerResponse) => Promise<void> {',
      '  let started: Promise<RequestListener> | null = null;',
      '',
      '  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {',
      '    const attempt = (started ??= boot());',
      '',
      '    let app: RequestListener;',
      '    try {',
      '      app = await attempt;',
      '    } catch {',
      '      if (started === attempt) started = null;',
      '      res.statusCode = 503;',
      "      res.setHeader('content-type', 'application/json; charset=utf-8');",
      "      res.end(JSON.stringify({ status: 'unavailable' }));",
      '      return;',
      '    }',
      '',
      '    // The one transformation, and the reason it is needed is in vercel.json:',
      '    // the intended path travels in a query parameter because catch-all',
      '    // routing matched exactly one segment however it was declared. A request',
      '    // that arrives without `__p` is passed through untouched.',
      "    const url = new URL(req.url ?? '/', 'http://localhost');",
      "    const target = url.searchParams.get('__p');",
      '    if (target !== null) {',
      "      // The caller's own query survives: the platform appends it to the",
      '      // destination, so it sits alongside __p and has to be handed back',
      '      // without it.',
      "      url.searchParams.delete('__p');",
      '      const query = url.searchParams.toString();',
      "      req.url = query === '' ? target : `${target}?${query}`;",
      '    }',
      '',
      '    app(req, res);',
      '  };',
      '}',
      '',
    ].join('\n'),

  'apps/api/src/config/serverless.spec.ts': () =>
    [
      "import type { IncomingMessage, ServerResponse } from 'node:http';",
      "import { createServerlessHandler, type RequestListener } from './serverless';",
      '',
      'const request = (url: string): IncomingMessage => ({ url }) as IncomingMessage;',
      '',
      'function response(): ServerResponse & { body: string } {',
      "  const res = { statusCode: 200, body: '', setHeader: () => undefined, end(b: string) { res.body = b; } };",
      '  return res as unknown as ServerResponse & { body: string };',
      '}',
      '',
      "describe('the serverless handler', () => {",
      "  it('restores the path the platform moved into __p', async () => {",
      '    const seen: string[] = [];',
      '    const app: RequestListener = (req) => {',
      "      seen.push(req.url ?? '');",
      '    };',
      '    const handler = createServerlessHandler(async () => app);',
      '',
      "    await handler(request('/api?__p=/links/abc/stats'), response());",
      '',
      "    expect(seen).toEqual(['/links/abc/stats']);",
      '  });',
      '',
      "  it(\"keeps the caller's own query and drops only __p\", async () => {",
      '    const seen: string[] = [];',
      '    const handler = createServerlessHandler(async () => (req) => {',
      "      seen.push(req.url ?? '');",
      '    });',
      '',
      "    await handler(request('/api?__p=/links&page=2'), response());",
      '',
      "    expect(seen).toEqual(['/links?page=2']);",
      '  });',
      '',
      "  it('boots once and reuses it, so start-up is not on every request', async () => {",
      '    let boots = 0;',
      '    const handler = createServerlessHandler(async () => {',
      '      boots += 1;',
      '      return () => undefined;',
      '    });',
      '',
      "    await handler(request('/api?__p=/a'), response());",
      "    await handler(request('/api?__p=/b'), response());",
      '',
      '    expect(boots).toBe(1);',
      '  });',
      '',
      "  it('forgets a failed boot rather than serving its error forever', async () => {",
      '    let boots = 0;',
      '    const handler = createServerlessHandler(async () => {',
      '      boots += 1;',
      "      if (boots === 1) throw new Error('database unreachable');",
      '      return () => undefined;',
      '    });',
      '',
      '    const first = response();',
      "    await handler(request('/api?__p=/a'), first);",
      '    expect(first.statusCode).toBe(503);',
      '',
      '    // The instance is still warm. Without the clear, this request would be',
      '    // answered by the remembered rejection instead of a fresh boot.',
      '    const second = response();',
      "    await handler(request('/api?__p=/a'), second);",
      '    expect(second.statusCode).toBe(200);',
      '    expect(boots).toBe(2);',
      '  });',
      '});',
      '',
    ].join('\n'),

  'apps/api/src/controller/health.controller.ts': () =>
    [
      "import { Controller, Get } from '@nestjs/common';",
      '',
      '/**',
      ' * Layer: controller. The first route, and a real one — something has to',
      ' * answer before a deployment can be called up.',
      ' */',
      "@Controller('health')",
      'export class HealthController {',
      '  @Get()',
      "  check(): { status: 'ok' } {",
      "    return { status: 'ok' };",
      '  }',
      '}',
      '',
    ].join('\n'),

  'apps/api/src/controller/health.controller.spec.ts': () =>
    [
      "import { HealthController } from './health.controller';",
      '',
      "describe('HealthController', () => {",
      "  it('answers ok', () => {",
      "    expect(new HealthController().check()).toEqual({ status: 'ok' });",
      '  });',
      '',
      "  it('answers a shape a caller can branch on, not a bare string', () => {",
      "    // A client reading 'ok' cannot tell a healthy service from one that",
      '    // echoes whatever it is asked. The key is what makes it checkable.',
      "    expect(Object.keys(new HealthController().check())).toEqual(['status']);",
      '  });',
      '});',
      '',
    ].join('\n'),

  'apps/api/src/app.module.ts': () =>
    [
      "import { Module } from '@nestjs/common';",
      "import { HealthController } from './controller/health.controller';",
      '',
      '@Module({ controllers: [HealthController] })',
      'export class AppModule {}',
      '',
    ].join('\n'),

  'apps/api/src/main.ts': (name) =>
    [
      "import 'reflect-metadata';",
      "import { NestFactory } from '@nestjs/core';",
      "import { AppModule } from './app.module';",
      '',
      '/**',
      ' * The long-lived process, for local development only. What runs in',
      ' * production is `api/index.ts`, which boots the same module.',
      ' */',
      'async function bootstrap(): Promise<void> {',
      '  const app = await NestFactory.create(AppModule);',
      '  const port = Number(process.env.API_PORT ?? 3100);',
      '  await app.listen(port);',
      `  console.log('${name} api on http://localhost:' + String(port));`,
      '}',
      '',
      'void bootstrap();',
      '',
    ].join('\n'),

  'api/index.ts': () =>
    [
      "import 'reflect-metadata';",
      "import type { IncomingMessage, ServerResponse } from 'node:http';",
      "import { NestFactory } from '@nestjs/core';",
      "import { AppModule } from '../apps/api/dist/app.module';",
      "import { createServerlessHandler } from '../apps/api/dist/config/serverless';",
      '',
      '/**',
      ' * The whole API, as one function. Every route reaches the application',
      ' * through here, and the application\'s own paths do not change.',
      ' *',
      ' * It imports the API\'s BUILD OUTPUT, not its source, and that is load',
      ' * bearing. Nest is built on legacy decorators, which need',
      ' * `experimentalDecorators`; the API\'s own tsconfig sets it and the',
      ' * repository root\'s does not, and the platform compiles this file against',
      ' * the root. Handed the source, it emits standard ES decorators, whose call',
      ' * signature differs — every controller then dies at import on a deployment',
      ' * that built perfectly. So the API is compiled by its own tsc first, and',
      ' * the platform never sees a decorator.',
      ' *',
      ' * `tsconfig.functions.json` exists so that this file is typechecked at all:',
      ' * it is in none of the workspace projects, and a build referencing it after',
      ' * `apps/api` is the only thing that catches a drift between the two.',
      ' */',
      'async function boot(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {',
      "  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });",
      '  await app.init();',
      '  return app.getHttpAdapter().getInstance() as (req: IncomingMessage, res: ServerResponse) => void;',
      '}',
      '',
      'export default createServerlessHandler(boot);',
      '',
    ].join('\n'),

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

  'apps/web/vite.config.ts': () =>
    [
      "import react from '@vitejs/plugin-react';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      '  // strictPort, so a port already taken is an error rather than a silent',
      '  // move to another one that every other tool is still looking for.',
      '  server: { port: Number(process.env.WEB_PORT ?? 5273), strictPort: true },',
      '});',
      '',
    ].join('\n'),

  'apps/web/index.html': (name) =>
    [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="utf-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `    <title>${name}</title>`,
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n'),

  'apps/web/src/main.tsx': () =>
    [
      "import { StrictMode } from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import { Home } from './Home';",
      '',
      "const root = document.getElementById('root');",
      "if (root === null) throw new Error('index.html has no #root to mount on');",
      '',
      'createRoot(root).render(',
      '  <StrictMode>',
      '    <Home />',
      '  </StrictMode>,',
      ');',
      '',
    ].join('\n'),

  'apps/web/src/Home.tsx': (name) =>
    [
      "import type { ReactElement } from 'react';",
      '',
      '/**',
      ' * The first page. One heading and one line, so a browser test has something',
      ' * to assert about and a person has something to look at.',
      ' *',
      ' * `ReactElement` rather than `JSX.Element`: React 19 removed the global JSX',
      ' * namespace, and the old annotation no longer compiles.',
      ' */',
      'export function Home(): ReactElement {',
      '  return (',
      '    <main>',
      `      <h1>${name}</h1>`,
      '      <p>The gate is green and nothing else is built yet.</p>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),

  'apps/web/src/Home.spec.tsx': (name) =>
    [
      "import { render, screen } from '@testing-library/react';",
      "import { Home } from './Home';",
      '',
      "describe('Home', () => {",
      "  it('shows the project name as the heading', () => {",
      '    render(<Home />);',
      `    expect(screen.getByRole('heading', { name: '${name}' })).toBeInTheDocument();`,
      '  });',
      '',
      "  it('says plainly that nothing is built yet, rather than looking finished', () => {",
      '    // A scaffold that looks like a product invites somebody to believe it is',
      '    // one, and the first honest thing this page can do is say what it is.',
      '    render(<Home />);',
      '    expect(screen.getByText(/nothing else is built yet/u)).toBeInTheDocument();',
      '  });',
      '});',
      '',
    ].join('\n'),
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
