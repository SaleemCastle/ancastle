'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { logoutAction } from '@/app/(auth)/login/actions';
import type { AuthActionState } from '@/lib/auth/action-state';

export function LogoutForm() {
    const [state, action, pending] = useActionState<AuthActionState>(logoutAction, {});
    return (
        <form action={action} className="space-y-2">
            <Button type="submit" variant="outline" disabled={pending}>
                {pending ? 'Signing out…' : 'Sign out'}
            </Button>
            {state.error && (
                <p role="alert" className="text-sm text-destructive">
                    {state.error}
                </p>
            )}
        </form>
    );
}
