import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Local development shares only the web server's settings from the root env file.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
    const values = parseEnv(readFileSync(rootEnv, 'utf8'));
    for (const name of [
        'API_INTERNAL_URL',
        'REDIS_URL',
        'WEB_APP_URL',
        'WEB_SESSION_TTL_SECONDS',
    ]) {
        if (values[name] !== undefined) process.env[name] ??= values[name];
    }
}

const nextConfig: NextConfig = {
    /* config options here */
    experimental: {
        agentFeedback: true,
    },
    cacheComponents: true,
    partialPrefetching: true,
    turbopack: {
        rules: {
            '*.css': {
                loaders: ['@tailwindcss/turbopack'],
                as: '*.css',
            },
        },
    },
};

export default nextConfig;
