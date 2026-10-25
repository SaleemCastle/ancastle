'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginSchema } from '@ancastle/validation';
import { authConfig } from '@/lib/auth/config';
import { AuthenticationRejectedError } from '@/lib/auth/errors';
import { webSessions } from '@/lib/auth/sessions';
import type { AuthActionState } from '@/lib/auth/action-state';

const invalidRequest = { error: 'The request could not be verified. Please reload and try again.' };

export async function loginAction(
    _previous: AuthActionState,
    formData: FormData,
): Promise<AuthActionState> {
    try {
        const config = authConfig();
        if ((await headers()).get('origin') !== config.origin) return invalidRequest;
        const parsed = loginSchema.safeParse({
            email: formData.get('email'),
            password: formData.get('password'),
        });
        if (!parsed.success) {
            return {
                fields: {
                    email: parsed.error.issues.some((issue) => issue.path[0] === 'email')
                        ? ['Enter a valid email address.']
                        : undefined,
                    password: parsed.error.issues.some((issue) => issue.path[0] === 'password')
                        ? ['Enter your password.']
                        : undefined,
                },
            };
        }
        const jar = await cookies();
        const sessions = webSessions();
        const id = await sessions.login(parsed.data, jar.get(config.cookie.name)?.value);
        try {
            jar.set(config.cookie.name, id, config.cookie.options);
        } catch {
            await sessions.logout(id).catch(() => undefined);
            return { error: 'Sign-in is temporarily unavailable. Please try again.' };
        }
    } catch (error) {
        if (error instanceof AuthenticationRejectedError)
            return { error: 'Invalid email or password.' };
        return { error: 'Sign-in is temporarily unavailable. Please try again.' };
    }
    redirect('/app/dashboard');
}

export async function logoutAction(): Promise<AuthActionState> {
    try {
        const config = authConfig();
        if ((await headers()).get('origin') !== config.origin) return invalidRequest;
        const jar = await cookies();
        const id = jar.get(config.cookie.name)?.value;
        if (id) await webSessions().logout(id);
        jar.set(config.cookie.name, '', {
            ...config.cookie.options,
            maxAge: 0,
            expires: new Date(0),
        });
    } catch {
        return { error: 'Sign-out is temporarily unavailable. Please try again.' };
    }
    redirect('/login');
}
