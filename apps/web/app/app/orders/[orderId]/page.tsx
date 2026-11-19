import type { Metadata } from 'next';
import Link from 'next/link';
import {
    orderDetailResponseSchema,
    orderEventListResponseSchema,
    paginationQuerySchema,
    resourceIdSchema,
} from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { OrderActions } from '@/components/sales-orders/order-actions';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { formatJmdAmount } from '@/lib/management/order-form';
import { FulfilmentPanel } from '@/components/sales-orders/fulfilment-panel';
import {
    salesProductListResponseSchema,
    poultryProductSourceListResponseSchema,
    fulfilmentListResponseSchema,
    fulfilmentQuerySchema,
} from '@ancastle/validation';
import { farmInventoryResponseSchema } from '@/lib/management/api';
import { flockApiPath, flockListResponseSchema } from '@/lib/management/flock-api';
import { flockMetricsDate } from '@/lib/management/flocks';

export const metadata: Metadata = { title: 'Sales order | Ancastle Farms' };

export default function SalesOrderDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ orderId: string }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/orders"
            title="Sales order"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('order:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const { orderId: rawId } = await params;
                const parsedId = resourceIdSchema.safeParse(rawId);
                if (!parsedId.success) throw new ManagementApiError('ORDER_NOT_FOUND');
                const parsedEventPage = paginationQuerySchema.safeParse({
                    page: search.eventPage,
                    pageSize: 20,
                });
                if (!parsedEventPage.success) throw new ManagementApiError('VALIDATION_ERROR');
                const base = `organizations/${current.organization.id}/orders/${parsedId.data}`;
                const [detail, eventPage] = await Promise.all([
                    managementApi(base, orderDetailResponseSchema),
                    managementApi(
                        `${base}/events?page=${parsedEventPage.data.page}&pageSize=${parsedEventPage.data.pageSize}`,
                        orderEventListResponseSchema,
                    ),
                ]);
                // Do not pass operational source details into client props, even for farm users.
                const { sourceDetails: _sourceDetails, ...order } = detail.data;
                void _sourceDetails;
                const lines = order.lines;
                const selectedFarm = context.farm;
                const farmChoices = current.farms;
                const availableSources: Array<{
                    id: string;
                    lineId: string;
                    label: string;
                    available: string;
                    unit: string;
                }> = [];
                let fulfilmentHistory: Array<{
                    id: string;
                    code: string;
                    kind: 'POSTING' | 'REVERSAL';
                    farmId: string;
                    occurredAt: string;
                    createdAt: string;
                    actorUserId: string;
                    note: string | null;
                    reference: string | null;
                    reversesFulfilmentId: string | null;
                    reason?: string;
                    postingErrorConfirmed?: true;
                    lines: Array<{
                        id: string;
                        orderLineId: string;
                        quantity: string;
                        unit: string;
                        sourceCode: string;
                        reversesLineId: string | null;
                    }>;
                }> = [];
                let fulfilmentHistoryPage = { page: 1, totalPages: 0 };
                if (selectedFarm && current.permissions.includes('sales-product:read')) {
                    const farmBase = `organizations/${current.organization.id}/farms/${selectedFarm.id}`;
                    const canReadPoultry =
                        current.permissions.includes('flock:read') &&
                        current.permissions.includes('sales-product:read');
                    const canReadProduce = current.permissions.includes('inventory:read');
                    const historyQuery = fulfilmentQuerySchema.safeParse({
                        page: search.fulfilmentPage,
                        pageSize: 20,
                        orderId: order.id,
                    });
                    if (!historyQuery.success) throw new ManagementApiError('VALIDATION_ERROR');
                    const [products, stock, flocks, history] = await Promise.all([
                        managementApi(
                            `organizations/${current.organization.id}/sales-products?page=1&pageSize=100&isActive=true`,
                            salesProductListResponseSchema,
                        ),
                        canReadProduce
                            ? managementApi(`${farmBase}/inventory`, farmInventoryResponseSchema)
                            : Promise.resolve(null),
                        canReadPoultry
                            ? managementApi(
                                  `${flockApiPath({ organization: current.organization.id, farm: selectedFarm.id })}?page=1&pageSize=100&isActive=true&ageAndMaturityAsOfDate=${flockMetricsDate()}`,
                                  flockListResponseSchema,
                              )
                            : Promise.resolve(null),
                        current.permissions.includes('fulfilment:read')
                            ? managementApi(
                                  `${farmBase}/fulfilments?orderId=${order.id}&page=${historyQuery.data.page}&pageSize=${historyQuery.data.pageSize}`,
                                  fulfilmentListResponseSchema,
                              )
                            : Promise.resolve(null),
                    ]);
                    fulfilmentHistory = history?.data ?? [];
                    fulfilmentHistoryPage = {
                        page: history?.meta.page ?? 1,
                        totalPages: history?.meta.totalPages ?? 0,
                    };
                    const productById = new Map(
                        products.data.map((product) => [product.id, product]),
                    );
                    for (const line of lines.filter(
                        (entry) => !entry.isRemoved && Number(entry.remainingQuantity) > 0,
                    )) {
                        const product = productById.get(line.productId);
                        if (!product || !product.isActive) continue;
                        if (
                            line.kind === 'PRODUCE' &&
                            product.kind === 'PRODUCE' &&
                            canReadProduce
                        ) {
                            const row = stock?.data.find(
                                (entry) =>
                                    entry.item.id === product.inventoryItemId &&
                                    entry.item.isActive,
                            );
                            if (row)
                                availableSources.push({
                                    id: row.item.id,
                                    lineId: line.id,
                                    label: `${row.item.code} · ${row.item.name}`,
                                    available: row.stockOnHand,
                                    unit: row.item.unit,
                                });
                        } else if (
                            line.kind === 'POULTRY' &&
                            product.kind === 'POULTRY' &&
                            flocks
                        ) {
                            const sources = await managementApi(
                                `${farmBase}/sales-products/${product.id}/poultry-sources?page=1&pageSize=100&isActive=true`,
                                poultryProductSourceListResponseSchema,
                            );
                            for (const source of sources?.data.filter(
                                (entry) => entry.isEligible,
                            ) ?? []) {
                                const flock = flocks.data.find(
                                    (entry) => entry.id === source.flockId,
                                );
                                if (flock)
                                    availableSources.push({
                                        id: flock.id,
                                        lineId: line.id,
                                        label: `${flock.code} · ${flock.name}`,
                                        available: String(flock.metrics.liveBirdCount),
                                        unit: 'EACH',
                                    });
                            }
                        }
                    }
                }
                const cancellable =
                    (order.commercialState === 'DRAFT' || order.commercialState === 'CONFIRMED') &&
                    order.fulfilmentProgress !== 'FULFILLED';
                const canEdit =
                    order.commercialState === 'DRAFT' &&
                    current.permissions.includes('order:manage');
                return (
                    <div className="space-y-6">
                        <header className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">{order.code}</p>
                                <h1 className="text-2xl font-semibold">{order.customer.name}</h1>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {order.customer.code} · {order.commercialState}
                                </p>
                            </div>
                            <Link
                                className="underline"
                                href={applicationHref('/app/orders', current.organization.id)}
                            >
                                Back to orders
                            </Link>
                        </header>
                        <section
                            aria-label="Commercial summary"
                            className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4"
                        >
                            <div>
                                <p className="text-sm text-muted-foreground">Created</p>
                                <p>{new Date(order.createdAt).toLocaleString('en-JM')}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Terms</p>
                                <p>
                                    {order.terms.saleType === 'CASH'
                                        ? 'CASH'
                                        : `CREDIT · ${order.terms.creditTermDays} days`}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Currency</p>
                                <p>{order.currency}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Commercial total</p>
                                <p className="font-semibold">
                                    {formatJmdAmount(order.totalAmount)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Fulfilment progress</p>
                                <p>
                                    {order.fulfilmentProgress?.replaceAll('_', ' ') ??
                                        'Not started'}
                                </p>
                            </div>
                        </section>
                        <section aria-label="Order lines" className="space-y-3">
                            <h2 className="text-lg font-semibold">Order lines</h2>
                            <div className="overflow-x-auto rounded-xl border bg-card">
                                <table className="w-full min-w-[700px] text-left text-sm">
                                    <caption className="sr-only">
                                        Order quantities and commercial price snapshots
                                    </caption>
                                    <thead className="border-b bg-muted/50">
                                        <tr>
                                            {[
                                                'Product',
                                                'Kind',
                                                'Ordered',
                                                'Fulfilled',
                                                'Remaining',
                                                'Unit price',
                                                'Line total',
                                                'Status',
                                            ].map((heading) => (
                                                <th key={heading} scope="col" className="p-3">
                                                    {heading}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {lines.map((line) => (
                                            <tr
                                                key={line.id}
                                                className={
                                                    line.isRemoved ? 'text-muted-foreground' : ''
                                                }
                                            >
                                                <td className="p-3">
                                                    {line.productName}
                                                    <span className="block text-xs">
                                                        {line.productCode}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {line.kind === 'POULTRY'
                                                        ? 'Poultry'
                                                        : 'Produce'}{' '}
                                                    · {line.unit}
                                                </td>
                                                <td className="p-3">
                                                    {line.orderedQuantity} {line.unit}
                                                </td>
                                                <td className="p-3">
                                                    {line.fulfilledQuantity} {line.unit}
                                                </td>
                                                <td className="p-3">
                                                    {line.remainingQuantity} {line.unit}
                                                </td>
                                                <td className="p-3">JMD {line.unitPrice}</td>
                                                <td className="p-3">
                                                    {formatJmdAmount(line.lineAmount)}
                                                </td>
                                                <td className="p-3">
                                                    {line.isRemoved
                                                        ? 'Removed draft line'
                                                        : (line.fulfilmentProgress?.replaceAll(
                                                              '_',
                                                              ' ',
                                                          ) ?? order.commercialState)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                        <p className="rounded-lg bg-muted p-4 text-sm">
                            CASH and CREDIT describe commercial terms only. This order view does not
                            track payments, invoices, balances, or due dates.
                        </p>
                        <section className="space-y-3" aria-label="Choose source farm">
                            <h2 className="text-lg font-semibold">
                                Fulfil from an authorized farm
                            </h2>
                            <form
                                className="flex flex-wrap items-end gap-3"
                                action={`/app/orders/${order.id}`}
                            >
                                <input
                                    type="hidden"
                                    name="organization"
                                    value={current.organization.id}
                                />
                                <label className="min-w-52 space-y-1 text-sm">
                                    Source farm
                                    <select
                                        name="farm"
                                        defaultValue={selectedFarm?.id ?? ''}
                                        className="h-11 w-full rounded-md border px-3"
                                    >
                                        <option value="">Select farm</option>
                                        {farmChoices.map((farm) => (
                                            <option key={farm.id} value={farm.id}>
                                                {farm.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <button className="min-h-11 rounded-md border px-4" type="submit">
                                    View source availability
                                </button>
                            </form>
                        </section>
                        <FulfilmentPanel
                            organization={current.organization.id}
                            orderId={order.id}
                            orderVersion={order.version}
                            farmId={selectedFarm?.id ?? null}
                            farmName={selectedFarm?.name}
                            canPost={
                                order.commercialState === 'CONFIRMED' &&
                                current.permissions.includes('fulfilment:post')
                            }
                            canReverse={current.permissions.includes('fulfilment:reverse')}
                            lines={lines
                                .filter((line) => !line.isRemoved)
                                .map((line) => ({
                                    id: line.id,
                                    productName: line.productName,
                                    kind: line.kind,
                                    unit: line.unit,
                                    remainingQuantity: line.remainingQuantity,
                                }))}
                            sources={availableSources}
                            history={fulfilmentHistory}
                            historyPage={fulfilmentHistoryPage.page}
                            historyPages={fulfilmentHistoryPage.totalPages}
                            historyHref={`/app/orders/${order.id}?organization=${current.organization.id}&farm=${selectedFarm?.id}`}
                        />
                        <div className="flex flex-wrap gap-3">
                            {canEdit && (
                                <Link
                                    className="inline-flex h-11 items-center rounded-md border px-4 underline"
                                    href={applicationHref(
                                        `/app/orders/${order.id}/edit`,
                                        current.organization.id,
                                    )}
                                >
                                    Edit draft
                                </Link>
                            )}
                            <OrderActions
                                organization={current.organization.id}
                                orderId={order.id}
                                version={order.version}
                                canConfirm={
                                    order.commercialState === 'DRAFT' &&
                                    current.permissions.includes('order:confirm')
                                }
                                canCancel={
                                    cancellable && current.permissions.includes('order:cancel')
                                }
                            />
                        </div>
                        <section aria-label="Order event history" className="space-y-3">
                            <h2 className="text-lg font-semibold">Order history</h2>
                            {eventPage.data.length === 0 ? (
                                <p className="rounded-xl border bg-card p-5 text-sm">
                                    No order events are available.
                                </p>
                            ) : (
                                <ol className="space-y-3">
                                    {eventPage.data.map((event) => (
                                        <li
                                            key={event.id}
                                            className="rounded-xl border bg-card p-4"
                                        >
                                            <p className="font-medium">{event.action}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {new Date(event.createdAt).toLocaleString('en-JM')}
                                            </p>
                                            {event.reason && (
                                                <p className="mt-2 text-sm">{event.reason}</p>
                                            )}
                                        </li>
                                    ))}
                                </ol>
                            )}
                            {eventPage.meta.totalPages > 1 && (
                                <nav
                                    aria-label="Order history pagination"
                                    className="flex flex-wrap gap-4 text-sm"
                                >
                                    {eventPage.meta.page > 1 ? (
                                        <Link
                                            className="underline"
                                            href={`${applicationHref(`/app/orders/${order.id}`, current.organization.id)}&eventPage=${eventPage.meta.page - 1}`}
                                        >
                                            Previous history page
                                        </Link>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Previous history page
                                        </span>
                                    )}
                                    <span>
                                        Page {eventPage.meta.page} of {eventPage.meta.totalPages}
                                    </span>
                                    {eventPage.meta.page < eventPage.meta.totalPages ? (
                                        <Link
                                            className="underline"
                                            href={`${applicationHref(`/app/orders/${order.id}`, current.organization.id)}&eventPage=${eventPage.meta.page + 1}`}
                                        >
                                            Next history page
                                        </Link>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Next history page
                                        </span>
                                    )}
                                </nav>
                            )}
                        </section>
                    </div>
                );
            }}
        />
    );
}
