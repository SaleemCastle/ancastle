import 'server-only';
import { AuthUnavailableError } from './errors';

export function authConfig() {
    try {
        const web = new URL(process.env.WEB_APP_URL ?? 'http://localhost:3000');
        const api = new URL(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000/api');
        const redis = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
        const ttl = Number(process.env.WEB_SESSION_TTL_SECONDS ?? 604800);
        const prefix = process.env.WEB_SESSION_PREFIX ?? 'ancastle:web-session:';
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(web.hostname);
        if (
            !['http:', 'https:'].includes(web.protocol) ||
            web.username ||
            web.password ||
            web.pathname !== '/' ||
            web.search ||
            web.hash ||
            !['http:', 'https:'].includes(api.protocol) ||
            api.username ||
            api.password ||
            api.search ||
            api.hash ||
            !['redis:', 'rediss:'].includes(redis.protocol) ||
            !Number.isSafeInteger(ttl) ||
            ttl < 1 ||
            ttl > 604800 ||
            !/^[a-zA-Z0-9:_-]{1,100}$/.test(prefix) ||
            (process.env.NODE_ENV === 'production' &&
                (!process.env.WEB_APP_URL || (web.protocol !== 'https:' && !loopback)))
        ) {
            throw new AuthUnavailableError();
        }
        return {
            origin: web.origin,
            apiUrl: api.toString().replace(/\/$/, '') + '/',
            redisUrl: redis.toString(),
            ttlSeconds: ttl,
            prefix,
            cookie: {
                name: web.protocol === 'https:' ? '__Host-ancastle-session' : 'ancastle-session',
                options: {
                    httpOnly: true,
                    secure: web.protocol === 'https:',
                    sameSite: 'lax' as const,
                    path: '/',
                    maxAge: ttl,
                },
            },
        };
    } catch {
        throw new AuthUnavailableError();
    }
}
