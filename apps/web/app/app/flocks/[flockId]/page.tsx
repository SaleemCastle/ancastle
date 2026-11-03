import type { Metadata } from 'next';
import Link from 'next/link';
import { ManagementPage } from '@/components/management/page';
import { FlockStatusForm } from '@/components/flocks/forms';
import { FlockDetails, FlockStatus } from '@/components/flocks/details';
import { buttonVariants } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { flockScope, loadFlock } from '@/lib/management/flock-api';

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
            render={async (context) => {
                const scope = flockScope(context);
                if (!scope) return <p>Select an available farm to view a flock.</p>;
                const { data } = await loadFlock(scope, (await params).flockId);
                const canManage = context.current!.permissions.includes('flock:manage');
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
                        <FlockDetails flock={data} />
                        {canManage ? (
                            <FlockStatusForm
                                key={scope.organization + scope.farm + data.id}
                                {...scope}
                                flock={data}
                            />
                        ) : (
                            <p className="mt-4 text-sm text-muted-foreground">
                                Your access to this flock is read-only.
                            </p>
                        )}
                    </>
                );
            }}
        />
    );
}
