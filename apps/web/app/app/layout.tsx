import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/current-user';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { SessionError } from '@/components/session-error';

async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
    try {
        await requireUser();
    } catch (error) {
        if (error instanceof AuthUnavailableError) return <SessionError />;
        throw error;
    }
    return <main className="min-h-screen bg-gray-50 p-6">{children}</main>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <Suspense
            fallback={
                <p className="p-6" role="status">
                    Checking your session…
                </p>
            }
        >
            <AuthenticatedLayout>{children}</AuthenticatedLayout>
        </Suspense>
    );
}
