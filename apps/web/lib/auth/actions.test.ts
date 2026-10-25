import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationRejectedError } from './errors';

const fake = vi.hoisted(() => ({
    origin: 'https://farms.example.com' as string | null,
    get: vi.fn(),
    set: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
}));
vi.mock('next/headers', () => ({
    headers: async () => (fake.origin ? new Headers({ origin: fake.origin }) : new Headers()),
    cookies: async () => ({ get: fake.get, set: fake.set }),
}));
vi.mock('next/navigation', () => ({
    redirect: (path: string) => {
        throw new Error('redirect:' + path);
    },
}));
vi.mock('@/lib/auth/sessions', () => ({
    webSessions: () => ({ login: fake.login, logout: fake.logout }),
}));

import { loginAction, logoutAction } from '../../app/(auth)/login/actions';

describe('Authentication actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        fake.origin = 'https://farms.example.com';
        fake.login.mockResolvedValue('a'.repeat(43));
        fake.logout.mockResolvedValue(undefined);
    });
    afterEach(() => vi.unstubAllEnvs());
    function form(email = ' User@Example.com ', password = 'test-input') {
        const data = new FormData();
        data.set('email', email);
        data.set('password', password);
        return data;
    }

    it('validates and normalizes shared contracts, then sets only an opaque secure cookie', async () => {
        await expect(loginAction({}, form())).rejects.toThrow('redirect:/app/dashboard');
        expect(fake.login).toHaveBeenCalledWith(
            { email: 'user@example.com', password: 'test-input' },
            undefined,
        );
        expect(fake.set).toHaveBeenCalledWith(
            '__Host-ancastle-session',
            'a'.repeat(43),
            expect.objectContaining({ httpOnly: true, secure: true, path: '/', sameSite: 'lax' }),
        );
    });

    it('returns safe field errors and never returns submitted credentials', async () => {
        const result = await loginAction({}, form('invalid', ''));
        expect(result.fields?.email).toEqual(['Enter a valid email address.']);
        expect(result.fields?.password).toEqual(['Enter your password.']);
        expect(fake.login).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty('password');
    });

    it.each([null, 'https://attacker.example'])(
        'rejects absent/foreign origins before authentication',
        async (origin) => {
            fake.origin = origin;
            expect((await loginAction({}, form())).error).toContain('could not be verified');
            expect((await logoutAction()).error).toContain('could not be verified');
            expect(fake.login).not.toHaveBeenCalled();
            expect(fake.logout).not.toHaveBeenCalled();
            expect(fake.set).not.toHaveBeenCalled();
        },
    );

    it('maps rejected credentials and unexpected failures to safe form errors', async () => {
        fake.login.mockRejectedValueOnce(new AuthenticationRejectedError());
        expect(await loginAction({}, form())).toEqual({ error: 'Invalid email or password.' });
        fake.login.mockRejectedValueOnce(new Error('private details'));
        expect(await loginAction({}, form())).toEqual({
            error: 'Sign-in is temporarily unavailable. Please try again.',
        });
    });

    it('removes a newly created session if cookie persistence fails', async () => {
        fake.set.mockImplementationOnce(() => {
            throw new Error('cookie failure');
        });
        expect((await loginAction({}, form())).error).toContain('temporarily unavailable');
        expect(fake.logout).toHaveBeenCalledWith('a'.repeat(43));
    });

    it('invalidates the current session and clears the host cookie with matching attributes', async () => {
        fake.get.mockReturnValue({ value: 'b'.repeat(43) });
        await expect(logoutAction()).rejects.toThrow('redirect:/login');
        expect(fake.logout).toHaveBeenCalledWith('b'.repeat(43));
        expect(fake.set).toHaveBeenCalledWith(
            '__Host-ancastle-session',
            '',
            expect.objectContaining({
                maxAge: 0,
                httpOnly: true,
                secure: true,
                path: '/',
                expires: new Date(0),
            }),
        );
    });

    it('keeps the cookie available for retry if Redis invalidation fails', async () => {
        fake.get.mockReturnValue({ value: 'b'.repeat(43) });
        fake.logout.mockRejectedValue(new Error('private details'));
        expect(await logoutAction()).toEqual({
            error: 'Sign-out is temporarily unavailable. Please try again.',
        });
        expect(fake.set).not.toHaveBeenCalled();
    });
});
