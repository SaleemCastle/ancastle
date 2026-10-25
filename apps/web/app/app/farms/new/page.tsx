import type { Metadata } from 'next';
import { ManagementApiError } from '@/lib/management/api';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ManagementForm } from '@/components/management/form';

export const metadata: Metadata = { title: 'Create farm | Ancastle Farms' };
export default function NewFarmPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/farms"
            title="Create farm"
            render={async (context) => {
                if (!context.current!.permissions.includes('farm:create'))
                    throw new ManagementApiError('FORBIDDEN');
                return (
                    <>
                        <h1 className="text-2xl font-semibold">Create farm</h1>
                        <ManagementForm
                            kind="create-farm"
                            organization={context.current!.organization.id}
                        />
                    </>
                );
            }}
        />
    );
}
