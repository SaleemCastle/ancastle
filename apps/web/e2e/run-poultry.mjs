// Run API, auth proxy and Next as owned Node children. Playwright's Windows
// webServer teardown kills shell process trees; direct children let this runner
// close each server through IPC and wait for its real close event instead.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { temporaryDatabase } from '../../api/dist/test/temporary-database.js';

const envFile = new URL('../../../.env', import.meta.url);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
for (const key of ['DATABASE_URL', 'REDIS_URL'])
    if (env[key] !== undefined) process.env[key] ??= env[key];

const runId = process.env.ANCASTLE_E2E_RUN_ID ?? randomUUID();
process.env.ANCASTLE_E2E_RUN_ID = runId;
process.env.WEB_SESSION_PREFIX = 'ancastle:test:browser:' + runId + ':';

async function availablePort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve a test port');
    await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    return String(address.port);
}

const apiPort = await availablePort();
const proxyPort = await availablePort();
const webPort = await availablePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const database = await temporaryDatabase();
const [{ name: databaseName }] = await database.prisma.$queryRaw`SELECT current_database() AS name`;
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.pathname = '/' + databaseName;

function startNode(label, script, cwd, childEnv) {
    const child = spawn(process.execPath, [script], {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
    });
    let spawnError;
    child.once('error', (error) => {
        spawnError = error;
    });
    const closed = new Promise((resolve) => {
        child.once('close', (code, signal) => {
            console.log(`[e2e-runner] ${label} closed: code=${code}, signal=${signal}`);
            resolve({ code, signal, error: spawnError });
        });
    });
    console.log(`[e2e-runner] started ${label}: pid=${child.pid}`);
    return { label, child, closed };
}

async function waitUntilReady(server, url) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const result = await Promise.race([
            server.closed.then((exit) => ({ exit })),
            fetch(url)
                .then(async (response) => {
                    await response.arrayBuffer();
                    return response.ok ? { ready: true } : { ready: false };
                })
                .catch(() => ({ ready: false })),
        ]);
        if ('exit' in result)
            throw new Error(
                `${server.label} exited before becoming ready: ${JSON.stringify(result.exit)}`,
            );
        if (result.ready) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`${server.label} did not become ready at ${url}`);
}

async function stopNode(server) {
    console.log(`[e2e-runner] stopping ${server.label}`);
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
        const exit = await server.closed;
        if (exit.error || exit.code !== 0)
            throw new Error(`${server.label} exited before cleanup: ${JSON.stringify(exit)}`);
        return;
    }
    if (!server.child.connected) {
        const exit = await server.closed;
        if (exit.error || exit.code !== 0)
            throw new Error(`${server.label} exited before cleanup: ${JSON.stringify(exit)}`);
        return;
    }
    await new Promise((resolve, reject) => {
        server.child.send({ type: 'shutdown' }, (error) => (error ? reject(error) : resolve()));
    });
    console.log(`[e2e-runner] ${server.label} acknowledged shutdown request`);
    const exit = await server.closed;
    if (exit.error || exit.code !== 0)
        throw new Error(`${server.label} did not shut down cleanly: ${JSON.stringify(exit)}`);
}

const servers = [];
const startedAt = Date.now();
let testExitCode = 1;
let cleanupError;

try {
    console.log(`[e2e-runner] endpoints: api=${apiOrigin}, proxy=${proxyOrigin}, web=${webOrigin}`);
    const api = startNode(
        'API',
        fileURLToPath(new URL('../../api/test/browser-api-server.mjs', import.meta.url)),
        new URL('../../api/', import.meta.url),
        {
            ...process.env,
            NODE_ENV: 'test',
            API_PORT: apiPort,
            WEB_APP_URL: webOrigin,
            DATABASE_URL: databaseUrl.toString(),
            REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
            JWT_SECRET: 'browser-tests-access-secret-at-least-32-characters',
            JWT_REFRESH_SECRET: 'browser-tests-refresh-secret-at-least-32-characters',
            JWT_ACCESS_TTL_SECONDS: '900',
            LOG_LEVEL: 'silent',
        },
    );
    servers.push(api);
    const proxy = startNode(
        'auth proxy',
        fileURLToPath(new URL('./auth-proxy.mjs', import.meta.url)),
        new URL('../', import.meta.url),
        {
            ...process.env,
            AUTH_PROXY_PORT: proxyPort,
            API_INTERNAL_TARGET: apiOrigin,
        },
    );
    servers.push(proxy);
    const web = startNode(
        'Next.js',
        fileURLToPath(new URL('./next-test-server.mjs', import.meta.url)),
        new URL('../', import.meta.url),
        {
            ...process.env,
            AUTH_PROXY_PORT: proxyPort,
            API_INTERNAL_TARGET: apiOrigin,
            WEB_APP_URL: webOrigin,
            WEB_PORT: webPort,
            API_INTERNAL_URL: proxyOrigin + '/api',
            REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
            WEB_SESSION_TTL_SECONDS: '300',
            ANCASTLE_E2E_EXTERNAL_SERVERS: '1',
        },
    );
    servers.push(web);
    await waitUntilReady(api, apiOrigin + '/health');
    await waitUntilReady(proxy, proxyOrigin + '/_fixture/health');
    await waitUntilReady(web, webOrigin + '/login');
    const cliArgs = [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config=' + (process.argv[2] ?? 'playwright.poultry.config.ts'),
        ...process.argv.slice(3),
    ];
    const child = spawn(process.execPath, cliArgs, {
        cwd: new URL('../', import.meta.url),
        stdio: 'inherit',
        env: {
            ...process.env,
            ANCASTLE_E2E_EXTERNAL_SERVERS: '1',
            ANCASTLE_E2E_API_ORIGIN: apiOrigin,
            ANCASTLE_E2E_PROXY_ORIGIN: proxyOrigin,
            ANCASTLE_E2E_WEB_ORIGIN: webOrigin,
            API_PORT: apiPort,
            AUTH_PROXY_PORT: proxyPort,
            WEB_PORT: webPort,
            WEB_APP_URL: webOrigin,
            API_INTERNAL_URL: proxyOrigin + '/api',
            DATABASE_URL: databaseUrl.toString(),
        },
        windowsHide: true,
    });
    testExitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => {
            console.log(`[e2e-runner] Playwright CLI exited: code=${code}`);
            resolve(code ?? 1);
        });
    });
} catch (error) {
    cleanupError = error;
} finally {
    for (const server of servers.slice().reverse()) {
        try {
            await stopNode(server);
        } catch (error) {
            cleanupError ??= error;
        }
    }
    await database.dispose();
}

if (cleanupError) throw cleanupError;
console.log(
    `[e2e-runner] run complete: exit=${testExitCode}, elapsedMs=${Date.now() - startedAt}, ownedServersRemaining=0`,
);
process.exitCode = testExitCode;
