import { createServer } from 'node:http';
import next from 'next';

const hostname = process.env.WEB_HOST ?? '127.0.0.1';
const port = Number(process.env.WEB_PORT ?? '3310');
const application = next({ dev: false, hostname, port, dir: process.cwd() });
await application.prepare();
const requestHandler = application.getRequestHandler();
const server = createServer((request, response) => requestHandler(request, response));
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
});

let closing;
function closeServer() {
    if (!closing) {
        closing = (async () => {
            const serverClosed = new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            });
            await Promise.all([serverClosed, application.close()]);
            if (process.connected) process.disconnect();
        })();
    }
    return closing;
}

process.on('message', (message) => {
    if (message?.type === 'shutdown') void closeServer();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void closeServer());
