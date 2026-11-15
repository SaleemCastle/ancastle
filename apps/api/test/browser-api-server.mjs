import { createApiApplication, environment } from '../dist/bootstrap.js';

let app;
let closing;
let shutdownRequested = false;

async function closeApplication() {
  shutdownRequested = true;
  if (!app) return;
  if (!closing) {
    closing = (async () => {
      if (app) await app.close();
      if (process.connected) process.disconnect();
    })();
  }
  await closing;
}

process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  void closeApplication();
});

app = await createApiApplication();
if (shutdownRequested) {
  await closeApplication();
} else {
  await app.listen(environment.API_PORT);
}
