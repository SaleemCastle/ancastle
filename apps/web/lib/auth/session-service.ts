import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '@ancastle/types';
import type { LoginInput } from '@ancastle/validation';
import type { AuthenticationBackend } from './backend';
import type { SessionStore, StoredSession } from './session-store';
import { AuthenticationRejectedError, AuthUnavailableError } from './errors';

export class WebSessions {
    constructor(
        private readonly store: SessionStore,
        private readonly backend: AuthenticationBackend,
        private readonly ttlSeconds: number,
        private readonly now: () => number = Date.now,
        private readonly pause: (ms: number) => Promise<void> = (ms) =>
            new Promise((resolve) => setTimeout(resolve, ms)),
    ) {}

    private async revoke(refreshToken: string): Promise<void> {
        // The browser session is removed first; an unavailable API cannot restore it.
        try {
            await this.backend.logout(refreshToken);
        } catch {}
    }

    async login(input: LoginInput, previousId?: string): Promise<string> {
        const response = await this.backend.login(input);
        const record: StoredSession = {
            version: randomUUID(),
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            accessExpiresAt: this.now() + response.expiresIn * 1000,
            expiresAt: this.now() + this.ttlSeconds * 1000,
        };
        let id: string | undefined;
        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                const candidate = randomBytes(32).toString('base64url');
                if (await this.store.create(candidate, record)) {
                    id = candidate;
                    break;
                }
            }
            if (!id) throw new AuthUnavailableError();
            if (previousId) await this.logout(previousId);
            return id;
        } catch {
            if (id) await this.store.take(id).catch(() => undefined);
            await this.revoke(record.refreshToken);
            throw new AuthUnavailableError();
        }
    }

    async logout(id: string): Promise<void> {
        const record = await this.store.take(id);
        if (record) await this.revoke(record.refreshToken);
    }

    private async refresh(id: string, rejected: StoredSession): Promise<StoredSession | null> {
        const owner = randomUUID();
        let acquired = false;
        // Bounded waiting for another request's refresh. No per-process auth cache.
        for (let attempt = 0; attempt < 240; attempt++) {
            const current = await this.store.read(id);
            if (!current) return null;
            if (current.version !== rejected.version) return current;
            if (await this.store.lock(id, owner)) {
                acquired = true;
                break;
            }
            await this.pause(25);
        }
        if (!acquired) throw new AuthUnavailableError();

        try {
            const current = await this.store.read(id);
            if (!current) return null;
            if (current.version !== rejected.version) return current;
            let response;
            try {
                response = await this.backend.refresh(current.refreshToken);
            } catch (error) {
                if (error instanceof AuthenticationRejectedError) {
                    await this.logout(id);
                    return null;
                }
                throw error;
            }
            const next: StoredSession = {
                ...current,
                version: randomUUID(),
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                accessExpiresAt: this.now() + response.expiresIn * 1000,
            };
            if (!(await this.store.replace(id, current.version, next))) {
                // A logout or lost refresh lease must never recreate an old session.
                await this.logout(id);
                await this.revoke(next.refreshToken);
                return null;
            }
            return next;
        } finally {
            await this.store.unlock(id, owner);
        }
    }

    async user(id: string): Promise<AuthenticatedUser | null> {
        return this.withAccessToken(id, (token) => this.backend.user(token));
    }

    /** Server-only adapter: tokens stay inside the supplied server callback. */
    async withAccessToken<T>(
        id: string,
        execute: (token: string) => Promise<T>,
    ): Promise<T | null> {
        let record = await this.store.read(id);
        if (!record) return null;
        if (record.accessExpiresAt <= this.now()) record = await this.refresh(id, record);
        if (!record) return null;
        try {
            return await execute(record.accessToken);
        } catch (error) {
            if (!(error instanceof AuthenticationRejectedError)) throw error;
        }
        record = await this.refresh(id, record);
        if (!record) return null;
        try {
            return await execute(record.accessToken);
        } catch (error) {
            if (!(error instanceof AuthenticationRejectedError)) throw error;
            await this.logout(id);
            return null;
        }
    }
}
