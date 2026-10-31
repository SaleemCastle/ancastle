import type { Metadata } from 'next';
import Link from 'next/link';
import { inventoryMovementQuerySchema } from '@ancastle/validation';

import { InventoryMovementForm } from '@/components/inventory/movement-form';
import { Button } from '@/components/ui/button';
import { ManagementPage } from '@/components/management/page';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import {
    farmInventoryResponseSchema,
    inventoryMovementListResponseSchema,
    managementApi,
    ManagementApiError,
} from '@/lib/management/api';

export const metadata: Metadata = {
    title: 'Farm stock | Ancastle Farms',
};

function displayReason(reason: string) {
    switch (reason) {
        case 'RECEIPT':
            return 'Receipt';
        case 'ISSUE':
            return 'Issue / usage';
        case 'ADJUSTMENT':
            return 'Adjustment';
        default:
            return reason;
    }
}

function stockStatusDetails(status: string) {
    switch (status) {
        case 'HEALTHY':
            return {
                label: 'Healthy',
                className:
                    'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
            };

        case 'LOW':
            return {
                label: 'Low stock',
                className:
                    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
            };

        case 'OUT_OF_STOCK':
            return {
                label: 'Out of stock',
                className:
                    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
            };

        case 'UNMONITORED':
            return {
                label: 'Not monitored',
                className: 'border-border bg-muted text-muted-foreground',
            };

        default:
            return {
                label: status,
                className: 'border-border bg-muted text-muted-foreground',
            };
    }
}

function displayDate(value: string) {
    return new Intl.DateTimeFormat('en-JM', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

export default function FarmStockPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/inventory/stock"
            title="Farm stock"
            render={async (context, search) => {
                const current = context.current!;
                const farm = context.farm;

                if (!current.permissions.includes('inventory:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                if (!farm) {
                    return (
                        <section className="rounded-xl border bg-card p-6">
                            <h1 className="text-2xl font-semibold">Select a farm</h1>

                            <p className="mt-2 text-sm text-muted-foreground">
                                Choose a farm from the application navigation to view its stock and
                                inventory movements.
                            </p>
                        </section>
                    );
                }

                const movementQuery = inventoryMovementQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    inventoryItemId:
                        search.inventoryItemId === '' ? undefined : search.inventoryItemId,
                    reason: search.reason === '' ? undefined : search.reason,
                });

                if (!movementQuery.success) {
                    throw new ManagementApiError('VALIDATION_ERROR');
                }

                const movementParams = new URLSearchParams({
                    page: String(movementQuery.data.page),
                    pageSize: String(movementQuery.data.pageSize),
                });

                if (movementQuery.data.inventoryItemId) {
                    movementParams.set('inventoryItemId', movementQuery.data.inventoryItemId);
                }

                if (movementQuery.data.reason) {
                    movementParams.set('reason', movementQuery.data.reason);
                }

                const basePath =
                    'organizations/' + current.organization.id + '/farms/' + farm.id + '/inventory';

                const [stock, movements] = await Promise.all([
                    managementApi(basePath, farmInventoryResponseSchema),
                    managementApi(
                        basePath + '/movements?' + movementParams.toString(),
                        inventoryMovementListResponseSchema,
                    ),
                ]);

                const itemById = new Map(stock.data.map((entry) => [entry.item.id, entry.item]));

                const canPost = current.permissions.includes('inventory:movement-post');

                const requestedStockStatus =
                    typeof search.stockStatus === 'string' ? search.stockStatus : undefined;

                const stockStatus =
                    requestedStockStatus === 'LOW' || requestedStockStatus === 'OUT_OF_STOCK'
                        ? requestedStockStatus
                        : undefined;

                const visibleStock = stockStatus
                    ? stock.data.filter((entry) => entry.stockStatus === stockStatus)
                    : stock.data;

                const pageHref = (page: number) => {
                    const value = new URLSearchParams(movementParams);

                    value.set('page', String(page));

                    return (
                        applicationHref('/app/inventory/stock', current.organization.id, farm.id) +
                        '&' +
                        value.toString()
                    );
                };

                return (
                    <div className="space-y-8">
                        <section>
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">
                                        {farm.code}
                                    </p>

                                    <h1 className="mt-1 text-2xl font-semibold">
                                        {farm.name} stock
                                    </h1>

                                    <p className="mt-2 text-sm text-muted-foreground">
                                        Stock balances are derived from posted inventory movements.
                                    </p>
                                </div>

                                <Link
                                    prefetch={false}
                                    href={applicationHref(
                                        '/app/inventory',
                                        current.organization.id,
                                    )}
                                    className="text-sm font-medium underline"
                                >
                                    Manage inventory items
                                </Link>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <form
                                action="/app/inventory/stock"
                                className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />

                                <input type="hidden" name="farm" value={farm.id} />

                                <div>
                                    <label
                                        htmlFor="stock-status-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Stock status
                                    </label>

                                    <select
                                        id="stock-status-filter"
                                        name="stockStatus"
                                        defaultValue={stockStatus ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All stock</option>

                                        <option value="LOW">Low stock</option>

                                        <option value="OUT_OF_STOCK">Out of stock</option>
                                    </select>
                                </div>

                                <Button type="submit" variant="outline" className="px-3 h-10">
                                    Apply filter
                                </Button>
                            </form>
                            <div>
                                <h2 className="text-lg font-semibold">Current stock</h2>

                                <p className="mt-1 text-sm text-muted-foreground">
                                    Current authoritative stock-on-hand for this farm.
                                </p>
                            </div>

                            {visibleStock.length === 0 ? (
                                <div className="rounded-xl border bg-card p-6">
                                    <p className="font-medium">
                                        {stock.data.length === 0
                                            ? 'No inventory items available.'
                                            : 'No inventory items match this stock status.'}
                                    </p>

                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {stock.data.length === 0
                                            ? 'Create an inventory item before posting farm stock movements.'
                                            : 'Try another stock status or view all stock.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-xl border bg-card">
                                    <table className="w-full min-w-180 text-left text-sm">
                                        <thead className="border-b bg-muted/50">
                                            <tr>
                                                <th className="px-4 py-3 font-medium">Item</th>
                                                <th className="px-4 py-3 font-medium">Unit</th>
                                                <th className="px-4 py-3 font-medium">Stock</th>
                                                <th className="px-4 py-3 font-medium">Threshold</th>
                                                <th className="px-4 py-3 font-medium">Status</th>
                                                <th className="px-4 py-3 font-medium">
                                                    Item status
                                                </th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {visibleStock.map(
                                                ({ item, stockOnHand, stockStatus }) => {
                                                    const status = stockStatusDetails(stockStatus);

                                                    return (
                                                        <tr
                                                            key={item.id}
                                                            className="border-b last:border-b-0"
                                                        >
                                                            <td className="px-4 py-3">
                                                                <p className="font-medium">
                                                                    {item.name}
                                                                </p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {item.code}
                                                                </p>
                                                            </td>

                                                            <td className="px-4 py-3">
                                                                {item.unit}
                                                            </td>

                                                            <td className="px-4 py-3 font-medium tabular-nums">
                                                                {stockOnHand}
                                                            </td>

                                                            <td className="px-4 py-3 tabular-nums">
                                                                {item.lowStockThreshold ??
                                                                    'Not set'}
                                                            </td>

                                                            <td className="px-4 py-3">
                                                                <span
                                                                    className={
                                                                        'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ' +
                                                                        status.className
                                                                    }
                                                                >
                                                                    {status.label}
                                                                </span>
                                                            </td>

                                                            <td className="px-4 py-3">
                                                                {item.isActive
                                                                    ? 'Active'
                                                                    : 'Inactive'}
                                                            </td>
                                                        </tr>
                                                    );
                                                },
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        {canPost && (
                            <InventoryMovementForm
                                organization={current.organization.id}
                                farm={farm.id}
                                items={stock.data.map((entry) => entry.item)}
                            />
                        )}

                        <section className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold">Movement history</h2>

                                <p className="mt-1 text-sm text-muted-foreground">
                                    Posted movements are immutable. Corrections are recorded as new
                                    adjustment movements.
                                </p>
                            </div>

                            <form
                                action="/app/inventory/stock"
                                className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />

                                <input type="hidden" name="farm" value={farm.id} />

                                <input
                                    type="hidden"
                                    name="pageSize"
                                    value={movementQuery.data.pageSize}
                                />

                                <div>
                                    <label
                                        htmlFor="movement-item-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Item
                                    </label>

                                    <select
                                        id="movement-item-filter"
                                        name="inventoryItemId"
                                        defaultValue={movementQuery.data.inventoryItemId ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All items</option>

                                        {stock.data.map(({ item }) => (
                                            <option key={item.id} value={item.id}>
                                                {item.code} · {item.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label
                                        htmlFor="movement-reason-filter"
                                        className="mb-2 block text-sm font-medium"
                                    >
                                        Reason
                                    </label>

                                    <select
                                        id="movement-reason-filter"
                                        name="reason"
                                        defaultValue={movementQuery.data.reason ?? ''}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                        <option value="">All reasons</option>
                                        <option value="RECEIPT">Receipt</option>
                                        <option value="ISSUE">Issue / usage</option>
                                        <option value="ADJUSTMENT">Adjustment</option>
                                    </select>
                                </div>

                                <Button type="submit" variant="outline">
                                    Apply filters
                                </Button>
                            </form>

                            {movements.data.length === 0 ? (
                                <div className="rounded-xl border bg-card p-6">
                                    <p className="font-medium">
                                        No inventory movements match this view.
                                    </p>

                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Posted receipts, issues and adjustments will appear here.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-xl border bg-card">
                                    <table className="w-full min-w-255 text-left text-sm">
                                        <thead className="border-b bg-muted/50">
                                            <tr>
                                                <th className="px-4 py-3 font-medium">Date</th>
                                                <th className="px-4 py-3 font-medium">Item</th>
                                                <th className="px-4 py-3 font-medium">Reason</th>
                                                <th className="px-4 py-3 font-medium">Quantity</th>
                                                <th className="px-4 py-3 font-medium">Actor</th>
                                                <th className="px-4 py-3 font-medium">Reference</th>
                                                <th className="px-4 py-3 font-medium">Notes</th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {movements.data.map((movement) => {
                                                const item = itemById.get(movement.inventoryItemId);

                                                return (
                                                    <tr
                                                        key={movement.id}
                                                        className="border-b align-top last:border-b-0"
                                                    >
                                                        <td className="whitespace-nowrap px-4 py-3">
                                                            {displayDate(movement.occurredAt)}
                                                        </td>

                                                        <td className="px-4 py-3">
                                                            {item?.name ?? 'Unavailable item'}
                                                        </td>

                                                        <td className="px-4 py-3">
                                                            {displayReason(movement.reason)}
                                                        </td>

                                                        <td className="px-4 py-3 font-medium tabular-nums">
                                                            {movement.quantity}
                                                        </td>

                                                        <td className="px-4 py-3 font-mono text-xs">
                                                            {movement.actorUserId}
                                                        </td>

                                                        <td className="px-4 py-3">
                                                            {movement.reference ?? '—'}
                                                        </td>

                                                        <td className="max-w-xs px-4 py-3">
                                                            {movement.note ?? '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {movements.meta.totalPages > 1 && (
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-sm text-muted-foreground">
                                        Page {movements.meta.page} of {movements.meta.totalPages} ·{' '}
                                        {movements.meta.totalItems} movements
                                    </p>

                                    <div className="flex gap-2">
                                        {movements.meta.page > 1 && (
                                            <Button variant="outline">
                                                <Link
                                                    prefetch={false}
                                                    href={pageHref(movements.meta.page - 1)}
                                                >
                                                    Previous
                                                </Link>
                                            </Button>
                                        )}

                                        {movements.meta.page < movements.meta.totalPages && (
                                            <Button variant="outline">
                                                <Link
                                                    prefetch={false}
                                                    href={pageHref(movements.meta.page + 1)}
                                                >
                                                    Next
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>
                    </div>
                );
            }}
        />
    );
}
