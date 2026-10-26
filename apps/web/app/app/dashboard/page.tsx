import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    ArrowUpRight,
    Building2,
    Leaf,
    MapPin,
    ShieldCheck,
    Warehouse,
} from 'lucide-react';
import { requireApplicationContext } from '@/lib/application/current-context';
import {
    ApplicationAccessDeniedError,
    applicationHref,
    type ApplicationSearch,
} from '@/lib/application/selection';
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

    const current = context.current;
    const name = current?.membership.displayName ?? context.user.email.split('@')[0];
    const canReadFarms = current?.permissions.includes('farm:read') ?? false;

    return (
        <ApplicationShell
            context={{ user: context.user, current, farm: context.farm }}
            organizations={context.organizations}
        >
            <div className="space-y-8">
                <header>
                    <p className="text-sm font-medium text-primary">WORKSPACE OVERVIEW</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                        Dashboard
                    </h1>
                    <p className="mt-2 text-muted-foreground">
                        <span className="font-medium text-foreground">Welcome back, {name}.</span> A
                        clear view of the people and places in your farm workspace.
                    </p>
                </header>

                {current ? (
                    <>
                        <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-green-700 p-6 text-white shadow-lg sm:p-9">
                            <div className="absolute -right-12 -top-20 -z-10 size-72 rounded-full border border-white/10" />
                            <div className="absolute -right-2 -top-10 -z-10 size-52 rounded-full border border-white/10" />
                            <Leaf
                                className="absolute right-10 top-8 -z-10 size-40 rotate-12 text-white/10 sm:right-20 sm:size-56"
                                aria-hidden="true"
                            />
                            <div className="max-w-2xl">
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-emerald-50">
                                    <span className="size-1.5 rounded-full bg-lime-300" />
                                    {context.farm ? 'Farm workspace' : 'Organization workspace'}
                                </div>
                                <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
                                    {context.farm ? context.farm.name : current.organization.name}
                                </h2>
                                {context.farm && (
                                    <p className="mt-1 text-sm font-medium text-emerald-100">
                                        Working in {context.farm.name}
                                    </p>
                                )}
                                <p className="mt-2 max-w-lg text-sm leading-6 text-emerald-50/85 sm:text-base">
                                    {context.farm
                                        ? 'Your farm workspace is ready. Use the navigation to manage your farm and organization.'
                                        : 'Your organization workspace brings your farms and team together in one place.'}
                                </p>
                                {canReadFarms && (
                                    <Link
                                        prefetch={false}
                                        href={applicationHref(
                                            '/app/farms',
                                            current.organization.id,
                                        )}
                                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                                    >
                                        Explore farms
                                        <ArrowRight className="size-4" aria-hidden="true" />
                                    </Link>
                                )}
                            </div>
                        </section>

                        <section
                            aria-label="Workspace summary"
                            className="grid gap-4 sm:grid-cols-3"
                        >
                            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Your farms</p>
                                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                                        <Warehouse className="size-5" aria-hidden="true" />
                                    </span>
                                </div>
                                <p className="mt-4 text-3xl font-semibold tracking-tight">
                                    {current.farms.length}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {current.farms.length === 1
                                        ? 'accessible farm'
                                        : 'accessible farms'}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Access permissions
                                    </p>
                                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                                        <ShieldCheck className="size-5" aria-hidden="true" />
                                    </span>
                                </div>
                                <p className="mt-4 text-2xl font-semibold tracking-tight">
                                    {current.permissions.length}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Granted in this workspace
                                </p>
                            </article>
                            <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Organizations</p>
                                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                                        <Building2 className="size-5" aria-hidden="true" />
                                    </span>
                                </div>
                                <p className="mt-4 text-3xl font-semibold tracking-tight">
                                    {context.organizations.length}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Available to your account
                                </p>
                            </article>
                        </section>

                        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
                            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h2 className="text-lg font-semibold">Your farms</h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Farms available in this organization.
                                        </p>
                                    </div>
                                    {canReadFarms && (
                                        <Link
                                            prefetch={false}
                                            href={applicationHref(
                                                '/app/farms',
                                                current.organization.id,
                                            )}
                                            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                                        >
                                            View all
                                            <ArrowUpRight className="size-4" aria-hidden="true" />
                                        </Link>
                                    )}
                                </div>
                                {current.farms.length ? (
                                    <ul className="mt-5 divide-y divide-border/80">
                                        {current.farms.slice(0, 4).map((farm) => (
                                            <li
                                                key={farm.id}
                                                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                                            >
                                                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                                                    <MapPin className="size-4" aria-hidden="true" />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-medium">
                                                        {farm.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Farm code: {farm.code}
                                                    </p>
                                                </div>
                                                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                                                    Accessible
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-5 rounded-xl bg-muted/70 p-4 text-sm text-muted-foreground">
                                        No farms are available to your account yet.
                                    </p>
                                )}
                            </div>

                            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
                                <h2 className="text-lg font-semibold">Workspace details</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Your current organization and access.
                                </p>
                                <dl className="mt-5 space-y-4">
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            Organization
                                        </dt>
                                        <dd className="mt-1 break-words text-sm font-medium">
                                            {current.organization.name}
                                        </dd>
                                    </div>
                                </dl>
                                {current.permissions.includes('organization:read') && (
                                    <Link
                                        prefetch={false}
                                        href={applicationHref(
                                            '/app/settings/organization',
                                            current.organization.id,
                                        )}
                                        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                                    >
                                        Organization settings
                                        <ArrowRight className="size-4" aria-hidden="true" />
                                    </Link>
                                )}
                            </div>
                        </section>
                    </>
                ) : (
                    <section className="rounded-2xl border border-border/80 bg-card p-8 shadow-sm">
                        <h2 className="text-lg font-semibold">No active organizations</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            No active organizations are available. Contact an administrator.
                        </p>
                    </section>
                )}
            </div>
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
