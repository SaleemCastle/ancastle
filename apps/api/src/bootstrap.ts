import dotenv from 'dotenv';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { validateEnvironment } from './config/env.validation.js';
import { Logger } from 'nestjs-pino';

dotenv.config({ path: '../../.env' });

export const environment = validateEnvironment(process.env);

export async function createApiApplication() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module.js');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.setGlobalPrefix('api', {
    exclude: ['health'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useLogger(app.get(Logger));
  return app;
}
