import { afterEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from './config';

describe('Web session configuration', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('uses a secure host-only HttpOnly cookie for HTTPS', () => {
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        const cookie = authConfig().cookie;
        expect(cookie.name).toBe('__Host-ancastle-session');
        expect(cookie.options).toMatchObject({
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
        expect(cookie.options).not.toHaveProperty('domain');
    });

    it('allows HTTP loopback for local development/production browser tests', () => {
        vi.stubEnv('WEB_APP_URL', 'http://127.0.0.1:3310');
        vi.stubEnv('NODE_ENV', 'production');
        expect(authConfig().cookie.options.secure).toBe(false);
    });

    it('rejects insecure public production origins without leaking configuration', () => {
        vi.stubEnv('WEB_APP_URL', 'http://farms.example.com');
        vi.stubEnv('NODE_ENV', 'production');
        expect(() => authConfig()).toThrow('Authentication is temporarily unavailable');
    });

    it('bounds session lifetime and rejects malformed server configuration', () => {
        vi.stubEnv('WEB_APP_URL', 'http://localhost:3000');
        vi.stubEnv('WEB_SESSION_TTL_SECONDS', '999999999');
        expect(() => authConfig()).toThrow('Authentication is temporarily unavailable');
    });
});
