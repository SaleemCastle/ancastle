import type { Metadata } from 'next';
import { ManagementApiError } from '@/lib/management/api';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { SupplierForm } from '@/components/suppliers/forms';

export const metadata: Metadata = {
    title: 'Add supplier | Ancastle Farms',
};

export default function NewSupplierPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/suppliers"
            title="Add supplier"
            render={async (context) => {
                const current = context.current!;

                if (!current.permissions.includes('supplier:create')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                return (
                    <>
                        <h1 className="text-2xl font-semibold">Add supplier</h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Create an individual or business supplier for this organization.
                        </p>

                        <SupplierForm mode="create" organization={current.organization.id} />
                    </>
                );
            }}
        />
    );
}
