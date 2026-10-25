import Link from 'next/link';
import type { ApplicationOrganization } from '@ancastle/types';
import { LogoutForm } from '@/components/logout-form';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import { ApplicationContextProvider, type ApplicationViewContext } from './context-provider';

const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

export function ApplicationShell({
    context,
    organizations,
    children,
}: {
    context: ApplicationViewContext;
    organizations: ApplicationOrganization[];
    children: React.ReactNode;
}) {
    const { user, current, farm } = context;
    return (
        <ApplicationContextProvider value={context}>
            <div className="min-h-screen bg-muted/30">
                <header className="border-b bg-background px-4 py-4 sm:px-6">
                    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="font-semibold">Ancastle Farms</p>
                            <p className="break-words text-sm text-muted-foreground">
                                {current?.organization.name ?? 'Your workspace'}
                            </p>
                        </div>
                        <p className="break-all text-sm">Signed in as {user.email}</p>
                        <details className="max-w-full rounded-md border bg-background p-2">
                            <summary className="cursor-pointer break-all text-sm">
                                User menu
                            </summary>
                            <div className="space-y-3 pt-3">
                                <p className="break-all text-sm">
                                    {current?.membership.displayName ?? user.email}
                                </p>
                                {current && (
                                    <p className="text-sm text-muted-foreground">
                                        {current.membership.role}
                                    </p>
                                )}
                                <LogoutForm />
                            </div>
                        </details>
                    </div>
                </header>
                <div className="mx-auto grid max-w-7xl gap-6 p-4 sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
                    <aside className="min-w-0 space-y-6">
                        {organizations.length > 1 && (
                            <form action="/app/dashboard" className="space-y-2">
                                <label
                                    htmlFor="organization-selection"
                                    className="block text-sm font-medium"
                                >
                                    Organization
                                </label>
                                <select
                                    id="organization-selection"
                                    name="organization"
                                    defaultValue={current?.organization.id}
                                    className={selectClass}
                                >
                                    {organizations.map((entry) => (
                                        <option
                                            key={entry.organization.id}
                                            value={entry.organization.id}
                                        >
                                            {entry.organization.name}
                                        </option>
                                    ))}
                                </select>
                                <Button type="submit" variant="outline" className="w-full">
                                    Switch organization
                                </Button>
                            </form>
                        )}
                        {current && (
                            <section aria-label="Farm context" className="space-y-2">
                                {current.farms.length > 1 ? (
                                    <form action="/app/dashboard" className="space-y-2">
                                        <input
                                            type="hidden"
                                            name="organization"
                                            value={current.organization.id}
                                        />
                                        <label
                                            htmlFor="farm-selection"
                                            className="block text-sm font-medium"
                                        >
                                            Farm
                                        </label>
                                        <select
                                            key={current.organization.id + (farm?.id ?? '')}
                                            id="farm-selection"
                                            name="farm"
                                            defaultValue={farm?.id ?? ''}
                                            className={selectClass}
                                        >
                                            <option value="">Choose a farm</option>
                                            {current.farms.map((entry) => (
                                                <option key={entry.id} value={entry.id}>
                                                    {entry.name} ({entry.code})
                                                </option>
                                            ))}
                                        </select>
                                        <Button type="submit" variant="outline" className="w-full">
                                            Use farm
                                        </Button>
                                    </form>
                                ) : farm ? (
                                    <p className="text-sm">
                                        <span className="font-medium">Farm: </span>
                                        {farm.name} ({farm.code})
                                    </p>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        No farms available. Contact an administrator for access.
                                    </p>
                                )}
                            </section>
                        )}
                        <nav aria-label="Primary navigation">
                            <Link
                                prefetch={false}
                                aria-current="page"
                                href={applicationHref(
                                    '/app/dashboard',
                                    current?.organization.id,
                                    farm?.id,
                                )}
                                className="block rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                            >
                                Dashboard
                            </Link>
                        </nav>
                    </aside>
                    <main className="min-w-0 rounded-xl border bg-background p-5 sm:p-6">
                        {children}
                    </main>
                </div>
            </div>
        </ApplicationContextProvider>
    );
}
