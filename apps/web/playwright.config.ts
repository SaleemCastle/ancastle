import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

// Invoke Playwright through e2e/run-poultry.mjs. It owns API, proxy, Next and
// disposable database lifecycles; Playwright webServer uses shell process-tree
// termination, which is not a graceful shutdown protocol on Windows.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
    const values = parseEnv(readFileSync(rootEnv, 'utf8'));
    for (const name of ['DATABASE_URL', 'REDIS_URL'])
        if (values[name] !== undefined) process.env[name] ??= values[name];
}
process.env.ANCASTLE_E2E_RUN_ID ??= randomUUID();
process.env.WEB_SESSION_PREFIX = 'ancastle:test:browser:' + process.env.ANCASTLE_E2E_RUN_ID + ':';
const origin = process.env.ANCASTLE_E2E_WEB_ORIGIN ?? 'http://127.0.0.1:3310';

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
});
