import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
    const values = parseEnv(readFileSync(rootEnv, 'utf8'));
    for (const name of ['DATABASE_URL', 'REDIS_URL'])
        if (values[name] !== undefined) process.env[name] ??= values[name];
}
process.env.ANCASTLE_E2E_RUN_ID ??= randomUUID();
process.env.WEB_SESSION_PREFIX = 'ancastle:test:browser:' + process.env.ANCASTLE_E2E_RUN_ID + ':';
const origin = 'http://127.0.0.1:3310';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 30000,
    reporter: 'list',
    use: {
        baseURL: origin,
        browserName: 'chromium',
        trace: 'off',
        screenshot: 'off',
        video: 'off',
    },
    webServer: [
        {
            command: 'node dist/main.js',
            cwd: '../api',
            url: 'http://127.0.0.1:4310/health',
            reuseExistingServer: false,
            timeout: 60000,
            env: {
                NODE_ENV: 'test',
                API_PORT: '4310',
                WEB_APP_URL: origin,
                DATABASE_URL: process.env.DATABASE_URL ?? '',
                REDIS_URL: redisUrl,
                JWT_SECRET: 'browser-tests-access-secret-at-least-32-characters',
                JWT_REFRESH_SECRET: 'browser-tests-refresh-secret-at-least-32-characters',
                JWT_ACCESS_TTL_SECONDS: '900',
                LOG_LEVEL: 'silent',
            },
        },
        {
            command: 'node e2e/auth-proxy.mjs',
            url: 'http://127.0.0.1:4311/_fixture/health',
            reuseExistingServer: false,
        },
        {
            command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3310',
            url: origin + '/login',
            reuseExistingServer: false,
            timeout: 60000,
            env: {
                WEB_APP_URL: origin,
                API_INTERNAL_URL: 'http://127.0.0.1:4311/api',
                REDIS_URL: redisUrl,
                WEB_SESSION_PREFIX: process.env.WEB_SESSION_PREFIX,
                WEB_SESSION_TTL_SECONDS: '300',
            },
        },
    ],
});
