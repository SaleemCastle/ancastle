// Test-only loopback proxy: exercises the real API while controlling transport failures.
import { createServer } from 'node:http';

let counters = { login: 0, refresh: 0, logout: 0 };
let mode = { unavailable: false, loginDelay: 0, contextUnavailable: false, contextDelay: 0 };

const server = createServer(async (request, response) => {
    try {
        const path = request.url ?? '/';
        if (path === '/_fixture/health') {
            response.end('ok');
            return;
        }
        if (path === '/_fixture/metrics') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(counters));
            return;
        }
        if (path === '/_fixture/reset') {
            counters = { login: 0, refresh: 0, logout: 0 };
            mode = {
                unavailable: false,
                loginDelay: 0,
                contextUnavailable: false,
                contextDelay: 0,
            };
            response.end('ok');
            return;
        }
        if (path === '/_fixture/mode') {
            let input = '';
            for await (const chunk of request) input += chunk;
            mode = { ...mode, ...JSON.parse(input) };
            response.end('ok');
            return;
        }
        if (!path.startsWith('/api/auth/') && !path.startsWith('/api/application/context')) {
            response.writeHead(404);
            response.end();
            return;
        }
        const operation = path.split('/').at(-1);
        if (operation === 'login' || operation === 'refresh' || operation === 'logout')
            counters[operation]++;
        if (path.startsWith('/api/application/context') && mode.contextDelay)
            await new Promise((resolve) => setTimeout(resolve, mode.contextDelay));
        if (
            mode.unavailable ||
            (mode.contextUnavailable && path.startsWith('/api/application/context'))
        ) {
            response.writeHead(503);
            response.end('private upstream error');
            return;
        }
        if (operation === 'login' && mode.loginDelay)
            await new Promise((resolve) => setTimeout(resolve, mode.loginDelay));
        let body = '';
        for await (const chunk of request) body += chunk;
        const headers = { 'Content-Type': 'application/json' };
        if (request.headers.authorization) headers.Authorization = request.headers.authorization;
        const upstream = await fetch('http://127.0.0.1:4310' + path, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : body,
            redirect: 'error',
        });
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        response.end(upstream.status === 204 ? undefined : await upstream.text());
    } catch {
        response.writeHead(502);
        response.end('Fixture transport unavailable');
    }
});
server.listen(4311, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit(0)));
