// Test-only loopback proxy: exercises the real API while controlling transport failures.
import { createServer } from 'node:http';

let counters = { login: 0, refresh: 0, logout: 0 };
let mode = {
    unavailable: false,
    loginDelay: 0,
    contextUnavailable: false,
    contextDelay: 0,
    fulfilmentResponseLoss: 0,
    fulfilmentConflict: 0,
    fulfilmentValidation: 0,
};
let closing;

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
                fulfilmentResponseLoss: 0,
                fulfilmentConflict: 0,
                fulfilmentValidation: 0,
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
        if (
            !path.startsWith('/api/auth/') &&
            !path.startsWith('/api/application/context') &&
            !path.startsWith('/api/organizations/')
        ) {
            response.writeHead(404);
            response.end();
            return;
        }
        const operation = path.split('/').at(-1);
        if (operation === 'login' || operation === 'refresh' || operation === 'logout')
            counters[operation]++;
        if (path.startsWith('/api/organizations/') && mode.organizationDelay)
            await new Promise((resolve) => setTimeout(resolve, mode.organizationDelay));
        if (path.startsWith('/api/application/context') && mode.contextDelay)
            await new Promise((resolve) => setTimeout(resolve, mode.contextDelay));
        if (
            mode.unavailable ||
            (mode.organizationUnavailable && path.startsWith('/api/organizations/')) ||
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
        if (request.headers['idempotency-key'])
            headers['Idempotency-Key'] = request.headers['idempotency-key'];
        if (
            request.method === 'POST' &&
            /\/orders\/[^/]+\/fulfilments$/.test(path) &&
            mode.fulfilmentValidation > 0
        ) {
            mode.fulfilmentValidation--;
            response.writeHead(422, { 'Content-Type': 'application/json' });
            response.end(
                JSON.stringify({
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Validation failed',
                        fields: { allocations: ['The command quantity is no longer valid.'] },
                    },
                }),
            );
            return;
        }
        if (
            request.method === 'POST' &&
            /\/orders\/[^/]+\/fulfilments$/.test(path) &&
            mode.fulfilmentConflict > 0
        ) {
            mode.fulfilmentConflict--;
            response.writeHead(409, { 'Content-Type': 'application/json' });
            response.end(
                JSON.stringify({
                    error: {
                        code: 'ORDER_VERSION_CONFLICT',
                        message: 'Order changed; reload and retry your edit',
                    },
                }),
            );
            return;
        }
        const upstream = await fetch(
            (process.env.API_INTERNAL_TARGET ?? 'http://127.0.0.1:4310') + path,
            {
                method: request.method,
                headers,
                body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : body,
                redirect: 'error',
            },
        );
        const upstreamBody = upstream.status === 204 ? undefined : await upstream.text();
        if (
            request.method === 'POST' &&
            /\/orders\/[^/]+\/fulfilments$|\/fulfilments\/[^/]+\/reverse$/.test(path) &&
            mode.fulfilmentResponseLoss > 0
        ) {
            mode.fulfilmentResponseLoss--;
            response.destroy();
            return;
        }
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        response.end(upstreamBody);
    } catch {
        response.writeHead(502);
        response.end('Fixture transport unavailable');
    }
});
server.listen(Number(process.env.AUTH_PROXY_PORT ?? '4311'), '127.0.0.1');

function closeServer() {
    if (!closing) {
        closing = new Promise((resolve) => {
            server.close(() => {
                if (process.connected) process.disconnect();
                resolve();
            });
            server.closeAllConnections();
        });
    }
    return closing;
}

process.on('message', (message) => {
    if (message?.type === 'shutdown') void closeServer();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void closeServer());
