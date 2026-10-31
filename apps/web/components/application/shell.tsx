import Link from 'next/link';
import {
    Building2,
    LayoutDashboard,
    Leaf,
    Settings2,
    UsersRound,
    Warehouse,
    ContactRound,
    Truck,
    PackageOpen,
} from 'lucide-react';
import type { ApplicationOrganization } from '@ancastle/types';
import { LogoutForm } from '@/components/logout-form';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import { ApplicationContextProvider, type ApplicationViewContext } from './context-provider';

const selectClass =
    'h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring';

export function ApplicationShell({
    context,
    organizations,
    children,
    activePath = '/app/dashboard',
}: {
    activePath?: string;
    context: ApplicationViewContext;
    organizations: ApplicationOrganization[];
    children: React.ReactNode;
}) {
    const { user, current, farm } = context;
    const navigationClass = (path: string) =>
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ' +
        (activePath === path
            ? 'bg-primary text-primary-foreground font-medium shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground');
    const displayName = current?.membership.displayName ?? user.email;

    return (
        <ApplicationContextProvider value={context}>
            <div className="min-h-screen bg-muted/70 lg:flex">
                <aside className="flex flex-col border-b bg-card px-4 py-5 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-5">
                    <Link
                        href={applicationHref('/app/dashboard', current?.organization.id, farm?.id)}
                        className="flex items-center gap-3 rounded-xl px-2 py-1"
                    >
                        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                            <Leaf className="size-5" aria-hidden="true" />
                        </span>
                        <span>
                            <span className="block text-base font-semibold tracking-tight">
                                Ancastle Farms
                            </span>
                            <span className="block text-xs text-muted-foreground">
                                Farm management
                            </span>
                        </span>
                    </Link>

                    <div className="mt-7 space-y-4">
                        {organizations.length > 1 && (
                            <form action={activePath} className="space-y-2">
                                <label
                                    htmlFor="organization-selection"
                                    className="block px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                                    <form action={activePath} className="space-y-2">
                                        <input
                                            type="hidden"
                                            name="organization"
                                            value={current.organization.id}
                                        />
                                        <label
                                            htmlFor="farm-selection"
                                            className="block px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                                        <p className="text-xs text-muted-foreground">
                                            Choose a farm to view farm operations.
                                        </p>
                                    </form>
                                ) : farm ? (
                                    <div className="rounded-xl border border-border/80 bg-muted/60 p-3">
                                        <p className="text-sm">
                                            <span className="font-medium">Farm: </span>
                                            {farm.name} ({farm.code})
                                        </p>
                                    </div>
                                ) : (
                                    <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                                        No farms available. Contact an administrator for access.
                                    </p>
                                )}
                            </section>
                        )}
                    </div>

                    <nav
                        aria-label="Primary navigation"
                        className="mt-6 grid grid-cols-2 gap-1 lg:block lg:space-y-1"
                    >
                        <Link
                            prefetch={false}
                            aria-current={activePath === '/app/dashboard' ? 'page' : undefined}
                            href={applicationHref(
                                '/app/dashboard',
                                current?.organization.id,
                                farm?.id,
                            )}
                            className={navigationClass('/app/dashboard')}
                        >
                            <LayoutDashboard className="size-4" aria-hidden="true" />
                            Dashboard
                        </Link>
                        {current?.permissions.includes('farm:read') && (
                            <Link
                                prefetch={false}
                                aria-current={activePath === '/app/farms' ? 'page' : undefined}
                                href={applicationHref('/app/farms', current.organization.id)}
                                className={navigationClass('/app/farms')}
                            >
                                <Warehouse className="size-4" aria-hidden="true" />
                                Farms
                            </Link>
                        )}
                        {current?.permissions.includes('inventory:read') && (
                            <>
                                <Link
                                    prefetch={false}
                                    aria-current={
                                        activePath === '/app/inventory' ? 'page' : undefined
                                    }
                                    href={applicationHref(
                                        '/app/inventory',
                                        current.organization.id,
                                    )}
                                    className={navigationClass('/app/inventory')}
                                >
                                    <PackageOpen className="size-4" aria-hidden="true" />
                                    Inventory items
                                </Link>

                                {farm && (
                                    <Link
                                        prefetch={false}
                                        aria-current={
                                            activePath === '/app/inventory/stock'
                                                ? 'page'
                                                : undefined
                                        }
                                        href={applicationHref(
                                            '/app/inventory/stock',
                                            current.organization.id,
                                            farm.id,
                                        )}
                                        className={navigationClass('/app/inventory/stock')}
                                    >
                                        <Warehouse className="size-4" aria-hidden="true" />
                                        Farm stock
                                    </Link>
                                )}
                            </>
                        )}
                        {current?.permissions.includes('customer:read') && (
                            <Link
                                prefetch={false}
                                aria-current={activePath === '/app/customers' ? 'page' : undefined}
                                href={applicationHref('/app/customers', current.organization.id)}
                                className={navigationClass('/app/customers')}
                            >
                                <ContactRound className="size-4" aria-hidden="true" />
                                Customers
                            </Link>
                        )}
                        {current?.permissions.includes('supplier:read') && (
                            <Link
                                prefetch={false}
                                aria-current={activePath === '/app/suppliers' ? 'page' : undefined}
                                href={applicationHref('/app/suppliers', current.organization.id)}
                                className={navigationClass('/app/suppliers')}
                            >
                                <Truck className="size-4" aria-hidden="true" />
                                Suppliers
                            </Link>
                        )}
                        {current?.permissions.includes('organization:read') && (
                            <Link
                                prefetch={false}
                                aria-current={
                                    activePath === '/app/settings/organization' ? 'page' : undefined
                                }
                                href={applicationHref(
                                    '/app/settings/organization',
                                    current.organization.id,
                                )}
                                className={navigationClass('/app/settings/organization')}
                            >
                                <Settings2 className="size-4" aria-hidden="true" />
                                Organization settings
                            </Link>
                        )}
                        {current?.permissions.includes('user:read') && (
                            <Link
                                prefetch={false}
                                aria-current={activePath === '/app/users' ? 'page' : undefined}
                                href={applicationHref('/app/users', current.organization.id)}
                                className={navigationClass('/app/users')}
                            >
                                <UsersRound className="size-4" aria-hidden="true" />
                                Organization users
                            </Link>
                        )}
                    </nav>

                    <div className="mt-6 border-t border-border/80 pt-5 lg:mt-auto">
                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-2 transition hover:bg-muted [&::-webkit-details-marker]:hidden">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                                    {displayName.charAt(0).toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">
                                        {displayName}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {user.email}
                                    </span>
                                </span>
                                <span className="sr-only">User menu</span>
                                <span
                                    className="text-muted-foreground transition-transform group-open:rotate-180"
                                    aria-hidden="true"
                                >
                                    ▾
                                </span>
                            </summary>
                            <div className="space-y-3 px-2 pb-2 pt-3">
                                {current && (
                                    <p className="text-sm text-muted-foreground">
                                        {current.membership.role}
                                    </p>
                                )}
                                <LogoutForm />
                            </div>
                        </details>
                    </div>
                </aside>

                <div className="min-w-0 flex-1">
                    <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-4 border-b border-border/70 bg-background/90 px-5 backdrop-blur sm:px-8">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                            <Building2
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <span className="truncate font-medium">
                                {current?.organization.name ?? 'Your workspace'}
                            </span>
                        </div>
                        {current && (
                            <span className="hidden max-w-[45%] truncate rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:block">
                                {farm ? farm.name : current.membership.role}
                            </span>
                        )}
                    </header>
                    <main className="mx-auto w-full max-w-screen-2xl p-5 sm:p-8 lg:p-10">
                        {children}
                    </main>
                </div>
            </div>
        </ApplicationContextProvider>
    );
}
