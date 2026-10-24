import dotenv from 'dotenv';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { Logger } from 'nestjs-pino';

dotenv.config({
	path: '../../.env',
});

async function bootstrap() {
	const { NestFactory } = await import('@nestjs/core');
	const { AppModule } = await import('./app.module.js');

	const app = await NestFactory.create(AppModule, {
		bufferLogs: true,
	});

	app.setGlobalPrefix('api');
	app.useGlobalFilters(new HttpExceptionFilter());
	app.useLogger(app.get(Logger));

	const port = process.env.API_PORT ?? 4000;

	await app.listen(port);
}

void bootstrap();