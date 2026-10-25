import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
    const values = parseEnv(readFileSync(rootEnv, 'utf8'));
    process.env.REDIS_URL ??= values.REDIS_URL;
}
