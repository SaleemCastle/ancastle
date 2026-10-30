import type { Metadata } from 'next';

import { InventoryItemForm } from '@/components/inventory/forms';
import { ManagementPage } from '@/components/management/page';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError } from '@/lib/management/api';

export const metadata: Metadata = {
    title: 'Add inventory item | Ancastle Farms',
};

export default function NewInventoryItemPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/inventory"
            title="Add inventory item"
            render={async (context) => {
                const current = context.current!;

                if (!current.permissions.includes('inventory:item-manage')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                return (
                    <>
                        <h1 className="text-2xl font-semibold">Add inventory item</h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Create an inventory item that can be used across farms in this
                            organization.
                        </p>

                        <InventoryItemForm mode="create" organization={current.organization.id} />
                    </>
                );
            }}
        />
    );
}
