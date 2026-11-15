import { createApiApplication, environment } from './bootstrap.js';

async function bootstrap() {
  const app = await createApiApplication();
  await app.listen(environment.API_PORT);
}

void bootstrap();
