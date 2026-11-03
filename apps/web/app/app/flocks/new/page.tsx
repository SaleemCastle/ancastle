import type { Metadata } from 'next';
import Link from 'next/link';
import { ManagementPage } from '@/components/management/page';
import { FlockForm } from '@/components/flocks/forms';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { flockScope } from '@/lib/management/flock-api';

export const metadata: Metadata = { title: 'Create flock | Ancastle Farms' };
export default function NewFlockPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/flocks"
            title="Create flock"
            render={async (context) => {
                const scope = flockScope(context, true);
                if (!scope) return <p>Select an available farm to create a flock.</p>;
                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/flocks', scope.organization, scope.farm)}
                            className="text-sm underline"
                        >
                            Back to flocks
                        </Link>
                        <h1 className="mt-4 text-2xl font-semibold">Create flock</h1>
                        <FlockForm key={scope.organization + scope.farm} {...scope} />
                    </>
                );
            }}
        />
    );
}
