import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * The long-lived process, for local development only. What runs in
 * production is `api/index.ts`, which boots the same module.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 3100);
  await app.listen(port);
  console.log('__PROJECT_NAME__ api on http://localhost:' + String(port));
}

void bootstrap();
