import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ApplicationAccessDeniedError, type ApplicationSearch } from '@/lib/application/selection';
import { ApplicationShell } from '@/components/application/shell';
import { SessionError } from '@/components/session-error';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { LogoutForm } from '@/components/logout-form';

export const metadata: Metadata = { title: 'Dashboard | Ancastle Farms' };

async function Dashboard({ searchParams }: { searchParams: Promise<ApplicationSearch> }) {
    let context;
    try {
        context = await requireApplicationContext(await searchParams);
    } catch (error) {
        if (error instanceof ApplicationAccessDeniedError)
            return (
                <main className="mx-auto max-w-md space-y-4 p-6">
                    <h1 className="text-xl font-semibold">Workspace unavailable</h1>
                    <p>This organization or farm is unavailable.</p>
                    <Link href="/app/dashboard" className="underline">
                        Choose an available workspace
                    </Link>
                    <LogoutForm />
                </main>
            );
        if (error instanceof AuthUnavailableError) return <SessionError />;
        throw error;
    }
    return (
        <ApplicationShell
            context={{ user: context.user, current: context.current, farm: context.farm }}
            organizations={context.organizations}
        >
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            {context.current ? (
                <>
                    <p className="mt-2 text-muted-foreground">
                        {context.current.organization.name}
                    </p>
                    <p className="mt-4">
                        {context.farm
                            ? 'Working in ' + context.farm.name
                            : context.current.farms.length > 1
                              ? 'Choose a farm to view farm operations.'
                              : 'Organization workspace'}
                    </p>
                </>
            ) : (
                <p className="mt-4">
                    No active organizations are available. Contact an administrator.
                </p>
            )}
        </ApplicationShell>
    );
}

export default function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <Suspense
            fallback={
                <p className="p-6" role="status">
                    Loading your workspace…
                </p>
            }
        >
            <Dashboard searchParams={searchParams} />
        </Suspense>
    );
}
