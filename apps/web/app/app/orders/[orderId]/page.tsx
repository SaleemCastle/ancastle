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
