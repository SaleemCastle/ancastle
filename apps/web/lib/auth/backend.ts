import 'server-only';
import type { LoginInput } from '@ancastle/validation';
import {
    authenticatedUserSchema,
    loginResponseSchema,
    refreshTokenResponseSchema,
} from '@ancastle/validation';
import type { AuthenticatedUser, LoginResponse, RefreshTokenResponse } from '@ancastle/types';
import { AuthenticationRejectedError, AuthUnavailableError } from './errors';

export interface AuthenticationBackend {
    login(input: LoginInput): Promise<LoginResponse>;
    refresh(refreshToken: string): Promise<RefreshTokenResponse>;
    user(accessToken: string): Promise<AuthenticatedUser>;
    logout(refreshToken: string): Promise<void>;
}

export class NestAuthenticationBackend implements AuthenticationBackend {
    constructor(
        private readonly baseUrl: string,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    private async request(path: string, init: RequestInit): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetcher(new URL(path, this.baseUrl), {
                ...init,
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(5000),
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...init.headers,
                },
            });
        } catch {
            throw new AuthUnavailableError();
        }
        if (response.status === 401 || response.status === 403)
            throw new AuthenticationRejectedError();
        if (!response.ok) throw new AuthUnavailableError();
        if (response.status === 204) return undefined;
        try {
            return await response.json();
        } catch {
            throw new AuthUnavailableError();
        }
    }

    async login(input: LoginInput): Promise<LoginResponse> {
        const parsed = loginResponseSchema.safeParse(
            await this.request('auth/login', { method: 'POST', body: JSON.stringify(input) }),
        );
        if (!parsed.success) throw new AuthUnavailableError();
        return parsed.data;
    }

    async refresh(refreshToken: string): Promise<RefreshTokenResponse> {
        const parsed = refreshTokenResponseSchema.safeParse(
            await this.request('auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken }),
            }),
        );
        if (!parsed.success) throw new AuthUnavailableError();
        return parsed.data;
    }

    async user(accessToken: string): Promise<AuthenticatedUser> {
        const parsed = authenticatedUserSchema.safeParse(
            await this.request('auth/me', {
                method: 'GET',
                headers: { Authorization: 'Bearer ' + accessToken },
            }),
        );
        if (!parsed.success) throw new AuthUnavailableError();
        return parsed.data;
    }

    async logout(refreshToken: string): Promise<void> {
        await this.request('auth/logout', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        });
    }
}
