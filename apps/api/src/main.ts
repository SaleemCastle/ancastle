import dotenv from 'dotenv';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { Logger } from 'nestjs-pino';

dotenv.config({
	path: '../../.env',
});

import { validateEnvironment } from './config/env.validation.js';
const env = validateEnvironment(process.env);

async function bootstrap() {
	const { NestFactory } = await import('@nestjs/core');
	const { AppModule } = await import('./app.module.js');

	const app = await NestFactory.create(AppModule, {
		bufferLogs: true,
	});

	app.setGlobalPrefix('api');
	app.useGlobalFilters(new HttpExceptionFilter());
	app.useLogger(app.get(Logger));

	await app.listen(env.API_PORT);
}

void bootstrap();