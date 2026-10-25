import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ApplicationAccessDeniedError, type ApplicationSearch } from '@/lib/application/selection';
import { AuthUnavailableError } from '@/lib/auth/errors';
import { ManagementApiError } from '@/lib/management/api';
import { SessionError } from '@/components/session-error';
import { LogoutForm } from '@/components/logout-form';
import { ApplicationShell } from '@/components/application/shell';

export type ManagementContext = Awaited<ReturnType<typeof requireApplicationContext>>;
interface Props {
    searchParams: Promise<ApplicationSearch>;
    activePath: string;
    title: string;
    render: (context: ManagementContext, search: ApplicationSearch) => Promise<ReactNode>;
}

async function Content({ searchParams, activePath, title, render }: Props) {
    const search = await searchParams;
    let context;
    try {
        context = await requireApplicationContext(search);
    } catch (error) {
        unstable_rethrow(error);
        if (error instanceof AuthUnavailableError) return <SessionError />;
        if (error instanceof ApplicationAccessDeniedError)
            return (
                <main className="mx-auto max-w-md space-y-4 p-6">
                    <h1 className="text-xl font-semibold">Workspace unavailable</h1>
                    <p>This organization or farm is unavailable.</p>
                    <Link prefetch={false} href="/app/dashboard" className="underline">
                        Choose an available workspace
                    </Link>
                    <LogoutForm />
                </main>
            );
        throw error;
    }
    let content: ReactNode = (
        <>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="mt-4">No active organizations are available. Contact an administrator.</p>
        </>
    );
    if (context.current) {
        try {
            content = await render(context, search);
        } catch (error) {
            unstable_rethrow(error);
            if (error instanceof AuthUnavailableError) content = <SessionError />;
            else if (error instanceof ManagementApiError)
                content = (
                    <>
                        <h1 className="text-2xl font-semibold">{title}</h1>
                        <p className="mt-4" role="alert">
                            {error.message}
                        </p>
                    </>
                );
            else throw error;
        }
    }
    return (
        <ApplicationShell
            activePath={activePath}
            context={{ user: context.user, current: context.current, farm: context.farm }}
            organizations={context.organizations}
        >
            {content}
        </ApplicationShell>
    );
}

export function ManagementPage(props: Props) {
    return (
        <Suspense
            fallback={
                <p className="p-6" role="status">
                    Loading {props.title.toLowerCase()}…
                </p>
            }
        >
            <Content {...props} />
        </Suspense>
    );
}
