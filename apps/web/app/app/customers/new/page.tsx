import type { Metadata } from 'next';
import { ManagementApiError } from '@/lib/management/api';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { CustomerForm } from '@/components/customers/forms';

export const metadata: Metadata = {
    title: 'Add customer | Ancastle Farms',
};

export default function NewCustomerPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/customers"
            title="Add customer"
            render={async (context) => {
                const current = context.current!;

                if (!current.permissions.includes('customer:create')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                return (
                    <>
                        <h1 className="text-2xl font-semibold">Add customer</h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Create an individual or business customer for this organization.
                        </p>

                        <CustomerForm mode="create" organization={current.organization.id} />
                    </>
                );
            }}
        />
    );
}
