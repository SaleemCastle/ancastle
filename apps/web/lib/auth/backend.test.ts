import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NestAuthenticationBackend } from './backend';
import { AuthenticationRejectedError, AuthUnavailableError } from './errors';

describe('Nest authentication adapter', () => {
    it('uses fixed server endpoints, no-store requests, bounded timeouts and validated DTOs', async () => {
        const user = { id: randomUUID(), email: 'user@example.com' };
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(JSON.stringify({ ...user, passwordHash: 'must-not-return' })),
            );
        const api = new NestAuthenticationBackend('http://api.test/api/', fetcher);
        expect(await api.user('test-access')).toEqual(user);
        const [url, init] = fetcher.mock.calls[0];
        expect(String(url)).toBe('http://api.test/api/auth/me');
        expect(init).toMatchObject({
            cache: 'no-store',
            redirect: 'error',
            headers: { Authorization: 'Bearer test-access' },
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('does not reflect backend authentication error messages', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response('private details', { status: 401 }));
        const api = new NestAuthenticationBackend('http://api.test/api/', fetcher);
        await expect(
            api.login({ email: 'user@example.com', password: 'test-input' }),
        ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    });

    it.each([
        () => new Response('private upstream error', { status: 500 }),
        () => new Response('not JSON'),
        () => new Response(JSON.stringify({ id: 'invalid', email: 'invalid', secret: 'private' })),
    ])(
        'returns only a safe error for unavailable or malformed upstream responses',
        async (response) => {
            const api = new NestAuthenticationBackend(
                'http://api.test/api/',
                vi.fn<typeof fetch>().mockResolvedValue(response()),
            );
            await expect(api.user('test-access')).rejects.toMatchObject({
                message: 'Authentication is temporarily unavailable',
            });
        },
    );

    it('sanitizes network errors', async () => {
        const api = new NestAuthenticationBackend(
            'http://api.test/api/',
            vi.fn<typeof fetch>().mockRejectedValue(new Error('private-url')),
        );
        await expect(api.refresh('test-refresh')).rejects.toBeInstanceOf(AuthUnavailableError);
    });
});
