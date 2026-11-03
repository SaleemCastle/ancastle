import type { Metadata } from 'next';
import Link from 'next/link';
import { ManagementPage } from '@/components/management/page';
import { FlockForm } from '@/components/flocks/forms';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { flockScope, loadFlock } from '@/lib/management/flock-api';

export const metadata: Metadata = { title: 'Edit flock | Ancastle Farms' };
export default function EditFlockPage({
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
            title="Edit flock"
            render={async (context) => {
                const scope = flockScope(context, true);
                if (!scope) return <p>Select an available farm to edit a flock.</p>;
                const { data } = await loadFlock(scope, (await params).flockId);
                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref(
                                '/app/flocks/' + data.id,
                                scope.organization,
                                scope.farm,
                            )}
                            className="text-sm underline"
                        >
                            Back to flock
                        </Link>
                        <h1 className="mt-4 wrap-break-word text-2xl font-semibold">
                            Edit {data.name}
                        </h1>
                        <FlockForm
                            key={scope.organization + scope.farm + data.id}
                            {...scope}
                            flock={data}
                        />
                    </>
                );
            }}
        />
    );
}
