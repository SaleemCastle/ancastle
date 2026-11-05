import type { Metadata } from 'next';
import Link from 'next/link';
import { ManagementPage } from '@/components/management/page';
import { FlockStatusForm } from '@/components/flocks/forms';
import { FlockDetails, FlockStatus } from '@/components/flocks/details';
import { buttonVariants } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { flockScope, loadFlock } from '@/lib/management/flock-api';
import { loadPoultryOperations } from '@/lib/management/poultry-api';
import { FlockPostingForm } from '@/components/flocks/posting-form';
import { PoultryHistory } from '@/components/flocks/history';

export const metadata: Metadata = { title: 'Flock details | Ancastle Farms' };
export default function FlockPage({
    searchParams,
    params,
}: {
    searchParams: Promise<ApplicationSearch>;
    params: Promise<{ flockId: string }>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/flocks"
            title="Flock details"
            render={async (context, search) => {
                const scope = flockScope(context);
                if (!scope) return <p>Select an available farm to view a flock.</p>;
                const { data } = await loadFlock(scope, (await params).flockId);
                const canManage = context.current!.permissions.includes('flock:manage');
                const permissions = context.current!.permissions;
                const inventoryRead = permissions.includes('inventory:read');
                const operations = await loadPoultryOperations(
                    scope,
                    data.id,
                    search,
                    inventoryRead,
                );
                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/flocks', scope.organization, scope.farm)}
                            className="text-sm underline"
                        >
                            Back to flocks
                        </Link>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <h1 className="wrap-break-word text-2xl font-semibold">{data.name}</h1>
                            <FlockStatus isActive={data.isActive} />
                            {canManage && (
                                <Link
                                    prefetch={false}
                                    href={applicationHref(
                                        `/app/flocks/${data.id}/edit`,
                                        scope.organization,
                                        scope.farm,
                                    )}
                                    className={buttonVariants({ variant: 'outline' })}
                                >
                                    Edit flock
                                </Link>
                            )}
                        </div>
                        <FlockDetails flock={data} feedItems={operations.items} />
                        {canManage ? (
                            <FlockStatusForm
                                key={scope.organization + scope.farm + data.id}
                                {...scope}
                                flock={data}
                            />
                        ) : (
                            <p className="mt-4 text-sm text-muted-foreground">
                                Your access to this flock definition is read-only.
                            </p>
                        )}
                        <section aria-label="Flock operations" className="mt-8 space-y-4">
                            {!data.isActive ? (
                                <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                                    This flock is closed. Operational history remains available; new
                                    postings require reactivation.
                                </p>
                            ) : (
                                <div className="grid items-start gap-6 xl:grid-cols-2">
                                    {permissions.includes('flock:mortality-post') && (
                                        <FlockPostingForm
                                            key={`${scope.organization}:${scope.farm}:${data.id}:mortality`}
                                            kind="mortality"
                                            {...scope}
                                            flockId={data.id}
                                        />
                                    )}
                                    {permissions.includes('flock:feed-usage-post') &&
                                        (inventoryRead &&
                                        operations.choices.some((item) => !item.outOfStock) ? (
                                            <FlockPostingForm
                                                key={`${scope.organization}:${scope.farm}:${data.id}:feed`}
                                                kind="feed"
                                                {...scope}
                                                flockId={data.id}
                                                choices={operations.choices}
                                            />
                                        ) : (
                                            <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                                                {inventoryRead
                                                    ? 'No active feed items with stock are available at this farm.'
                                                    : 'Inventory read access is needed to select a feed item.'}
                                            </p>
                                        ))}
                                </div>
                            )}
                        </section>
                        <PoultryHistory {...scope} flockId={data.id} operations={operations} />
                    </>
                );
            }}
        />
    );
}
