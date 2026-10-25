'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { loginAction } from './actions';
import type { AuthActionState } from '@/lib/auth/action-state';

const initialState: AuthActionState = {};

export function LoginForm() {
    const [state, action, pending] = useActionState(loginAction, initialState);
    return (
        <form action={action} className="mt-8 space-y-5" aria-label="Sign in">
            <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium">
                    Email
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    aria-invalid={Boolean(state.fields?.email)}
                    aria-describedby={state.fields?.email ? 'email-error' : undefined}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {state.fields?.email && (
                    <p id="email-error" className="text-sm text-destructive">
                        {state.fields.email[0]}
                    </p>
                )}
            </div>
            <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium">
                    Password
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    aria-invalid={Boolean(state.fields?.password)}
                    aria-describedby={state.fields?.password ? 'password-error' : undefined}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {state.fields?.password && (
                    <p id="password-error" className="text-sm text-destructive">
                        {state.fields.password[0]}
                    </p>
                )}
            </div>
            {state.error && (
                <p role="alert" className="text-sm text-destructive">
                    {state.error}
                </p>
            )}
            <Button type="submit" size="lg" disabled={pending} className="h-11 w-full">
                {pending ? 'Signing in…' : 'Sign in'}
            </Button>
            <p aria-live="polite" className="sr-only">
                {pending ? 'Signing in. Please wait.' : ''}
            </p>
        </form>
    );
}
