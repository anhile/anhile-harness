import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/dist/app.module';
import { createServerlessHandler } from '../apps/api/dist/config/serverless';

/**
 * The whole API, as one function. Every route reaches the application
 * through here, and the application's own paths do not change.
 *
 * It imports the API's BUILD OUTPUT, not its source, and that is load
 * bearing. Nest is built on legacy decorators, which need
 * `experimentalDecorators`; the API's own tsconfig sets it and the
 * repository root's does not, and the platform compiles this file against
 * the root. Handed the source, it emits standard ES decorators, whose call
 * signature differs — every controller then dies at import on a deployment
 * that built perfectly. So the API is compiled by its own tsc first, and
 * the platform never sees a decorator.
 *
 * `tsconfig.functions.json` exists so that this file is typechecked at all:
 * it is in none of the workspace projects, and a build referencing it after
 * `apps/api` is the only thing that catches a drift between the two.
 */
async function boot(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  return app.getHttpAdapter().getInstance() as (req: IncomingMessage, res: ServerResponse) => void;
}

export default createServerlessHandler(boot);
