// Committed ledger records cannot be deleted for fixture cleanup. Reuse M4's
// disposable database helper and drop only its owned random test database.
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { temporaryDatabase } from '../../api/dist/test/temporary-database.js';

const envFile = new URL('../../../.env', import.meta.url);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
for (const key of ['DATABASE_URL', 'REDIS_URL'])
    if (env[key] !== undefined) process.env[key] ??= env[key];
const database = await temporaryDatabase();
try {
    const [{ name }] = await database.prisma.$queryRaw`SELECT current_database() AS name`;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = '/' + name;
    const child = spawn(
        process.execPath,
        ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.poultry.config.ts'],
        {
            cwd: new URL('../', import.meta.url),
            stdio: 'inherit',
            env: { ...process.env, DATABASE_URL: url.toString() },
        },
    );
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
    });
} finally {
    await database.dispose();
}
