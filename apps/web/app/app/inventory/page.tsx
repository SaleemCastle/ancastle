import type { Metadata } from 'next';
import Link from 'next/link';
import { inventoryQuerySchema } from '@ancastle/validation';

import {
    inventoryItemListResponseSchema,
    managementApi,
    ManagementApiError,
} from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { Button } from '@/components/ui/button';
import {
    MasterDataList,
    MasterDataStatus,
    type MasterDataColumn,
} from '@/components/management/master-data-list';

export const metadata: Metadata = {
    title: 'Inventory | Ancastle Farms',
};

function label(value: string): string {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function InventoryPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/inventory"
            title="Inventory"
            render={async (context, search) => {
                const current = context.current!;

                if (!current.permissions.includes('inventory:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                const parsed = inventoryQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    search: search.search,
                    isActive: search.isActive === '' ? undefined : search.isActive,
                });

                if (!parsed.success) {
                    throw new ManagementApiError('VALIDATION_ERROR');
                }

                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });

                if (parsed.data.search) {
                    query.set('search', parsed.data.search);
                }

                if (parsed.data.isActive !== undefined) {
                    query.set('isActive', String(parsed.data.isActive));
                }

                const result = await managementApi(
                    'organizations/' +
                        current.organization.id +
                        '/inventory-items?' +
                        query.toString(),
                    inventoryItemListResponseSchema,
                );

                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));

                    return (
                        applicationHref('/app/inventory', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };

                const canEdit = current.permissions.includes('inventory:item-manage');

                const columns: MasterDataColumn<(typeof result.data)[number]>[] = [
                    {
                        key: 'code',
                        header: 'Code',
                        render: (item) => <span className="font-medium">{item.code}</span>,
                    },
                    {
                        key: 'name',
                        header: 'Item',
                        render: (item) => (
                            <div>
                                <p className="font-medium">{item.name}</p>

                                {item.description && (
                                    <p className="max-w-xs text-xs text-muted-foreground">
                                        {item.description}
                                    </p>
                                )}
                            </div>
                        ),
                    },
                    {
                        key: 'unit',
                        header: 'Unit',
                        render: (item) => label(item.unit),
                    },
                    {
                        key: 'category',
                        header: 'Category',
                        render: (item) => label(item.category),
                    },
                    {
                        key: 'threshold',
                        header: 'Low-stock threshold',
                        render: (item) => item.lowStockThreshold ?? 'Not set',
                    },
                    {
                        key: 'status',
                        header: 'Status',
                        render: (item) => <MasterDataStatus isActive={item.isActive} />,
                    },
                    {
                        key: 'actions',
                        header: 'Actions',
                        render: (item) => (
                            <Link
                                prefetch={false}
                                href={applicationHref(
                                    '/app/inventory/' + item.id,
                                    current.organization.id,
                                )}
                                className="font-medium text-primary hover:underline"
                            >
                                {canEdit ? 'Edit' : 'View'}
                                <span className="sr-only"> {item.name}</span>
                            </Link>
                        ),
                    },
                ];

                const hasQuery = Boolean(parsed.data.search) || parsed.data.isActive !== undefined;

                return (
                    <MasterDataList
                        title="Inventory items"
                        description="Manage the inventory items available across this organization."
                        caption="Inventory items"
                        items={result.data}
                        getRowKey={(item) => item.id}
                        columns={columns}
                        primaryAction={
                            canEdit
                                ? {
                                      label: 'Add inventory item',
                                      href: applicationHref(
                                          '/app/inventory/new',
                                          current.organization.id,
                                      ),
                                  }
                                : undefined
                        }
                        search={{
                            action: '/app/inventory',
                            organization: current.organization.id,
                            defaultValue: parsed.data.search,
                            placeholder: 'Search inventory by name or code...',
                            pageSize: parsed.data.pageSize,
                            hiddenFields: {
                                isActive:
                                    parsed.data.isActive === undefined
                                        ? undefined
                                        : String(parsed.data.isActive),
                            },
                        }}
                        filters={
                            <form
                                action="/app/inventory"
                                className="flex flex-wrap items-end gap-3"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />

                                <input type="hidden" name="pageSize" value={parsed.data.pageSize} />

                                {parsed.data.search && (
                                    <input type="hidden" name="search" value={parsed.data.search} />
                                )}

                                <div>
                                    <label
                                        htmlFor="inventory-status-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Status
                                    </label>

                                    <select
                                        id="inventory-status-filter"
                                        name="isActive"
                                        defaultValue={search.isActive ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All items</option>
                                        <option value="true">Active</option>
                                        <option value="false">Inactive</option>
                                    </select>
                                </div>

                                <Button type="submit" variant="outline" className="h-10">
                                    Apply filter
                                </Button>
                            </form>
                        }
                        emptyTitle={
                            hasQuery
                                ? 'No inventory items match this view.'
                                : 'No inventory items yet.'
                        }
                        emptyDescription={
                            hasQuery
                                ? 'Try changing the search or status filter.'
                                : 'Add your first inventory item to begin tracking farm stock.'
                        }
                        pagination={{
                            page: result.meta.page,
                            totalPages: result.meta.totalPages,
                            totalItems: result.meta.totalItems,
                            itemLabel: 'item',
                            previousHref:
                                result.meta.page > 1 ? pageHref(result.meta.page - 1) : undefined,
                            nextHref:
                                result.meta.page < result.meta.totalPages
                                    ? pageHref(result.meta.page + 1)
                                    : undefined,
                        }}
                    />
                );
            }}
        />
    );
}
