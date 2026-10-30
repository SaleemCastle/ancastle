import type { Metadata } from 'next';
import { resourceIdSchema } from '@ancastle/validation';

import { InventoryItemForm, InventoryItemStatusForm } from '@/components/inventory/forms';
import { ManagementPage } from '@/components/management/page';
import type { ApplicationSearch } from '@/lib/application/selection';
import {
    inventoryItemResponseSchema,
    managementApi,
    ManagementApiError,
} from '@/lib/management/api';

export const metadata: Metadata = {
    title: 'Inventory item | Ancastle Farms',
};

export default function InventoryItemPage({
    params,
    searchParams,
}: {
    params: Promise<{
        inventoryItemId: string;
    }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/inventory"
            title="Inventory item"
            render={async (context) => {
                const current = context.current!;

                if (!current.permissions.includes('inventory:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                const route = await params;

                const id = resourceIdSchema.safeParse(route.inventoryItemId);

                if (!id.success) {
                    throw new ManagementApiError('INVENTORY_ITEM_NOT_FOUND');
                }

                const result = await managementApi(
                    'organizations/' + current.organization.id + '/inventory-items/' + id.data,
                    inventoryItemResponseSchema,
                );

                const item = result.data;
                const canEdit = current.permissions.includes('inventory:item-manage');
                const canManageLifecycle = current.permissions.includes(
                    'inventory:lifecycle-manage',
                );

                return (
                    <>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">{item.code}</p>

                            <h1 className="mt-1 text-2xl font-semibold">{item.name}</h1>

                            <p className="mt-2 text-sm text-muted-foreground">
                                {canEdit
                                    ? 'Update this organization inventory item.'
                                    : 'View this organization inventory item.'}
                            </p>
                        </div>

                        {canEdit ? (
                            <InventoryItemForm
                                mode="update"
                                organization={current.organization.id}
                                inventoryItemId={item.id}
                                code={item.code}
                                name={item.name}
                                description={item.description}
                                unit={item.unit}
                                category={item.category}
                                lowStockThreshold={item.lowStockThreshold}
                            />
                        ) : (
                            <div className="mt-6 max-w-2xl space-y-5 rounded-xl border bg-card p-5">
                                <div>
                                    <p className="text-sm text-muted-foreground">Unit</p>
                                    <p className="font-medium">{item.unit}</p>
                                </div>

                                <div>
                                    <p className="text-sm text-muted-foreground">Category</p>
                                    <p className="font-medium">{item.category}</p>
                                </div>

                                <div>
                                    <p className="text-sm text-muted-foreground">Description</p>
                                    <p className="font-medium">
                                        {item.description || 'No description'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm text-muted-foreground">
                                        Low-stock threshold
                                    </p>
                                    <p className="font-medium">
                                        {item.lowStockThreshold ?? 'Not set'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm text-muted-foreground">Status</p>
                                    <p className="font-medium">
                                        {item.isActive ? 'Active' : 'Inactive'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {canManageLifecycle && (
                            <div className="max-w-2xl">
                                <InventoryItemStatusForm
                                    organization={current.organization.id}
                                    inventoryItemId={item.id}
                                    isActive={item.isActive}
                                />
                            </div>
                        )}
                    </>
                );
            }}
        />
    );
}
