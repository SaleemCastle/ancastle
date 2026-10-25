import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisSessionStore, type StoredSession } from './session-store';
import { WebSessions } from './session-service';
import { AuthenticationRejectedError, AuthUnavailableError } from './errors';
import type { AuthenticationBackend } from './backend';

describe('Redis web sessions', () => {
    const client = createClient({
        url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
        socket: { reconnectStrategy: false },
    });
    const prefix = 'ancastle:test:web-session:' + randomUUID() + ':';
    const ids: string[] = [];
    const user = { id: randomUUID(), email: 'session-user@example.com' };
    let clock: number;
    let store: RedisSessionStore;
    let backend: {
        [K in keyof AuthenticationBackend]: ReturnType<typeof vi.fn<AuthenticationBackend[K]>>;
    };
    let sessions: WebSessions;
    const key = (id: string) => prefix + createHash('sha256').update(id).digest('hex');

    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.close();
    });
    beforeEach(() => {
        clock = Date.now();
        store = new RedisSessionStore(
            async () => client,
            prefix,
            () => clock,
        );
        backend = {
            login: vi.fn<AuthenticationBackend['login']>().mockResolvedValue({
                accessToken: 'test-access',
                refreshToken: 'test-refresh',
                expiresIn: 900,
                user,
                memberships: [],
            }),
            refresh: vi.fn<AuthenticationBackend['refresh']>().mockResolvedValue({
                accessToken: 'rotated-access',
                refreshToken: 'rotated-refresh',
                expiresIn: 900,
            }),
            user: vi.fn<AuthenticationBackend['user']>().mockResolvedValue(user),
            logout: vi.fn<AuthenticationBackend['logout']>().mockResolvedValue(undefined),
        };
        sessions = new WebSessions(store, backend, 604800, () => clock);
    });
    afterEach(async () => {
        for (const id of ids.splice(0)) await client.del([key(id), key(id) + ':lock']);
        vi.restoreAllMocks();
    });

    async function login() {
        const id = await sessions.login({ email: user.email, password: 'test-input' });
        ids.push(id);
        return id;
    }

    it('stores tokens only in Redis behind a random handle and hashed key with a TTL', async () => {
        const id = await login();
        expect(id).toMatch(/^[a-zA-Z0-9_-]{43}$/);
        expect(key(id)).not.toContain(id);
        const record = JSON.parse((await client.get(key(id)))!) as StoredSession;
        expect(record).toMatchObject({ accessToken: 'test-access', refreshToken: 'test-refresh' });
        expect(JSON.stringify(record)).not.toContain(id);
        expect(await client.pTTL(key(id))).toBeGreaterThan(0);
        expect(await sessions.user(id)).toEqual(user);
        expect(backend.refresh).not.toHaveBeenCalled();
    });

    it('rotates handles on login and removes/revokes the previous web session', async () => {
        const previous = await login();
        const next = await sessions.login({ email: user.email, password: 'test-input' }, previous);
        ids.push(next);
        expect(next).not.toBe(previous);
        expect(await store.read(previous)).toBeNull();
        expect(await store.read(next)).not.toBeNull();
        expect(backend.logout).toHaveBeenCalledWith('test-refresh');
    });

    it('refreshes expired access tokens without extending the absolute web session lifetime', async () => {
        const id = await login();
        const before = await store.read(id);
        clock += 901000;
        expect(await sessions.user(id)).toEqual(user);
        const after = await store.read(id);
        expect(after?.version).not.toBe(before?.version);
        expect(after?.expiresAt).toBe(before?.expiresAt);
        expect(after?.refreshToken).toBe('rotated-refresh');
        expect(backend.refresh).toHaveBeenCalledTimes(1);
    });

    it('coordinates concurrent refresh requests through Redis', async () => {
        const id = await login();
        clock += 901000;
        const result = await Promise.all(Array.from({ length: 8 }, () => sessions.user(id)));
        expect(result).toEqual(Array.from({ length: 8 }, () => user));
        expect(backend.refresh).toHaveBeenCalledTimes(1);
    });

    it('does not recreate a session if logout completes during refresh', async () => {
        const id = await login();
        clock += 901000;
        let release!: () => void;
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        backend.refresh.mockImplementation(async () => {
            entered();
            await pending;
            return { accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 900 };
        });
        const reading = sessions.user(id);
        await started;
        await sessions.logout(id);
        release();
        expect(await reading).toBeNull();
        expect(await store.read(id)).toBeNull();
        expect(backend.logout).toHaveBeenCalledWith('late-refresh');
    });

    it('fences stale refresh writes and releases only the owned lease', async () => {
        const id = await login();
        const current = (await store.read(id))!;
        expect(await store.lock(id, 'first')).toBe(true);
        expect(await store.lock(id, 'second')).toBe(false);
        await store.unlock(id, 'second');
        expect(await store.lock(id, 'third')).toBe(false);
        await store.unlock(id, 'first');
        expect(await store.replace(id, randomUUID(), { ...current, version: randomUUID() })).toBe(
            false,
        );
        expect(await store.read(id)).toEqual(current);
        await sessions.logout(id);
        expect(
            await store.replace(id, current.version, { ...current, version: randomUUID() }),
        ).toBe(false);
    });

    it('bounds waiting when another request holds the refresh lease', async () => {
        const id = await login();
        clock += 901000;
        await store.lock(id, 'other-process');
        const pause = vi.fn(async () => undefined);
        const bounded = new WebSessions(store, backend, 604800, () => clock, pause);
        await expect(bounded.user(id)).rejects.toBeInstanceOf(AuthUnavailableError);
        expect(pause).toHaveBeenCalledTimes(240);
        expect(backend.refresh).not.toHaveBeenCalled();
        expect(await store.read(id)).not.toBeNull();
    });

    it('recovers from an access-token rejection once, and rejects repeated failures', async () => {
        const id = await login();
        backend.user.mockRejectedValueOnce(new AuthenticationRejectedError());
        expect(await sessions.user(id)).toEqual(user);
        expect(backend.refresh).toHaveBeenCalledTimes(1);
        backend.user.mockRejectedValue(new AuthenticationRejectedError());
        expect(await sessions.user(id)).toBeNull();
        expect(await store.read(id)).toBeNull();
    });

    it('invalidates rejected refresh sessions and never loops', async () => {
        const id = await login();
        clock += 901000;
        backend.refresh.mockRejectedValue(new AuthenticationRejectedError());
        expect(await sessions.user(id)).toBeNull();
        expect(await store.read(id)).toBeNull();
        expect(backend.refresh).toHaveBeenCalledTimes(1);
    });

    it('preserves session state on an upstream outage instead of treating it as a logout', async () => {
        const id = await login();
        clock += 901000;
        const before = await store.read(id);
        backend.refresh.mockRejectedValue(new AuthUnavailableError());
        await expect(sessions.user(id)).rejects.toBeInstanceOf(AuthUnavailableError);
        expect(await store.read(id)).toEqual(before);
    });

    it('expires sessions and removes corrupt state without exposing its contents', async () => {
        const id = await login();
        clock += 604800001;
        expect(await sessions.user(id)).toBeNull();
        expect(await client.get(key(id))).toBeNull();
        await client.set(key(id), '{"unexpected":"private-value"}');
        expect(await store.read(id)).toBeNull();
        expect(await client.get(key(id))).toBeNull();
    });

    it('rejects malformed handles without touching Redis', async () => {
        const connection = vi.fn(async () => client);
        const isolated = new RedisSessionStore(connection, prefix);
        for (const id of ['', 'invalid', '../keys', 'a'.repeat(100)])
            expect(await isolated.read(id)).toBeNull();
        expect(connection).not.toHaveBeenCalled();
    });

    it('revokes the new API session if saving a login fails', async () => {
        vi.spyOn(store, 'create').mockRejectedValue(new AuthUnavailableError());
        await expect(
            sessions.login({ email: user.email, password: 'test-input' }),
        ).rejects.toBeInstanceOf(AuthUnavailableError);
        expect(backend.logout).toHaveBeenCalledWith('test-refresh');
    });

    it('sanitizes Redis failures', async () => {
        const broken = new RedisSessionStore(async () => {
            throw new Error('private connection details');
        }, prefix);
        await expect(broken.read(randomBytes(32).toString('base64url'))).rejects.toMatchObject({
            message: 'Authentication is temporarily unavailable',
        });
    });
    it('uses coordinated refresh for server-only resource callbacks without returning token records', async () => {
        const id = await login();
        const execute = vi
            .fn<(token: string) => Promise<{ data: string[] }>>()
            .mockResolvedValue({ data: ['safe-resource'] });
        execute.mockRejectedValueOnce(new AuthenticationRejectedError());
        expect(await sessions.withAccessToken(id, execute)).toEqual({ data: ['safe-resource'] });
        expect(execute).toHaveBeenNthCalledWith(1, 'test-access');
        expect(execute).toHaveBeenNthCalledWith(2, 'rotated-access');
        expect(backend.refresh).toHaveBeenCalledTimes(1);
        expect(await sessions.withAccessToken('invalid', execute)).toBeNull();
    });
});
