import dotenv from 'dotenv';

dotenv.config({
	path: '../../.env',
});

async function bootstrap() {
	const { NestFactory } = await import('@nestjs/core');
	const { AppModule } = await import('./app.module.js');

	const app = await NestFactory.create(AppModule);

	app.setGlobalPrefix('api');

	const port = process.env.API_PORT ?? 4000;

	await app.listen(port);
}

void bootstrap();