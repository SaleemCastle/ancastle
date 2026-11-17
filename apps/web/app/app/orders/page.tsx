import type { Metadata } from 'next';
import Link from 'next/link';
import { orderQuerySchema, orderListResponseSchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { MasterDataList, type MasterDataColumn } from '@/components/management/master-data-list';
import { Button } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { formatJmdAmount } from '@/lib/management/order-form';

export const metadata: Metadata = { title: 'Sales orders | Ancastle Farms' };

function pagesHref(organization: string, search: URLSearchParams, page: number) {
    const query = new URLSearchParams(search);
    query.set('page', String(page));
    return applicationHref('/app/orders', organization) + '&' + query.toString();
}

export default function SalesOrdersPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/orders"
            title="Sales orders"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('order:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const parsed = orderQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    search: search.search,
                    customerId: search.customerId,
                    state: search.state,
                    progress: search.progress,
                });
                if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });
                if (parsed.data.search) query.set('search', parsed.data.search);
                if (parsed.data.customerId) query.set('customerId', parsed.data.customerId);
                if (parsed.data.state) query.set('state', parsed.data.state);
                if (parsed.data.progress) query.set('progress', parsed.data.progress);
                const result = await managementApi(
                    `organizations/${current.organization.id}/orders?${query}`,
                    orderListResponseSchema,
                );
                const columns: MasterDataColumn<(typeof result.data)[number]>[] = [
                    {
                        key: 'code',
                        header: 'Order',
                        render: (order) => (
                            <Link
                                className="font-medium underline"
                                prefetch={false}
                                href={applicationHref(
                                    `/app/orders/${order.id}`,
                                    current.organization.id,
                                )}
                            >
                                {order.code}
                            </Link>
                        ),
                    },
                    {
                        key: 'customer',
                        header: 'Customer',
                        render: (order) => (
                            <span>
                                {order.customer.name}
                                <span className="block text-xs text-muted-foreground">
                                    {order.customer.code}
                                </span>
                            </span>
                        ),
                    },
                    {
                        key: 'status',
                        header: 'Status',
                        render: (order) => order.commercialState,
                    },
                    {
                        key: 'progress',
                        header: 'Fulfilment progress',
                        render: (order) => order.fulfilmentProgress?.replaceAll('_', ' ') ?? '—',
                    },
                    {
                        key: 'date',
                        header: 'Order date',
                        render: (order) => new Date(order.createdAt).toLocaleDateString('en-JM'),
                    },
                    {
                        key: 'total',
                        header: 'Commercial total',
                        render: (order) => formatJmdAmount(order.totalAmount),
                    },
                    {
                        key: 'terms',
                        header: 'Terms',
                        render: (order) =>
                            order.terms.saleType === 'CASH'
                                ? 'CASH'
                                : `CREDIT · ${order.terms.creditTermDays} days`,
                    },
                ];
                const filterValues = new URLSearchParams();
                if (parsed.data.pageSize !== 20)
                    filterValues.set('pageSize', String(parsed.data.pageSize));
                if (parsed.data.search) filterValues.set('search', parsed.data.search);
                if (parsed.data.customerId) filterValues.set('customerId', parsed.data.customerId);
                if (parsed.data.state) filterValues.set('state', parsed.data.state);
                if (parsed.data.progress) filterValues.set('progress', parsed.data.progress);
                const path = '/app/orders';
                return (
                    <div className="space-y-6">
                        <MasterDataList
                            title="Sales orders"
                            description="Commercial commitments and their posted progress. Creating or confirming an order does not reserve stock or birds."
                            caption="Sales orders"
                            items={result.data}
                            getRowKey={(order) => order.id}
                            columns={columns}
                            primaryAction={
                                current.permissions.includes('order:manage')
                                    ? {
                                          label: 'Create order',
                                          href: applicationHref(
                                              '/app/orders/new',
                                              current.organization.id,
                                          ),
                                      }
                                    : undefined
                            }
                            search={{
                                action: path,
                                organization: current.organization.id,
                                defaultValue: parsed.data.search,
                                placeholder: 'Search order code or customer',
                                hiddenFields: {
                                    pageSize: parsed.data.pageSize,
                                    customerId: parsed.data.customerId,
                                    state: parsed.data.state,
                                    progress: parsed.data.progress,
                                },
                            }}
                            filters={
                                <form action={path} className="flex flex-wrap items-end gap-3">
                                    <input
                                        type="hidden"
                                        name="organization"
                                        value={current.organization.id}
                                    />
                                    <input
                                        type="hidden"
                                        name="pageSize"
                                        value={parsed.data.pageSize}
                                    />
                                    {parsed.data.search && (
                                        <input
                                            type="hidden"
                                            name="search"
                                            value={parsed.data.search}
                                        />
                                    )}
                                    <label className="space-y-2 text-sm">
                                        State
                                        <select
                                            name="state"
                                            defaultValue={parsed.data.state ?? ''}
                                            className="h-10 rounded-md border bg-background px-3"
                                        >
                                            <option value="">All states</option>
                                            <option value="DRAFT">Draft</option>
                                            <option value="CONFIRMED">Confirmed</option>
                                            <option value="CANCELLED">Cancelled</option>
                                        </select>
                                    </label>
                                    <label className="space-y-2 text-sm">
                                        Fulfilment progress
                                        <select
                                            name="progress"
                                            defaultValue={parsed.data.progress ?? ''}
                                            className="h-10 rounded-md border bg-background px-3"
                                        >
                                            <option value="">Any progress</option>
                                            <option value="UNFULFILLED">Unfulfilled</option>
                                            <option value="PARTIALLY_FULFILLED">
                                                Partially fulfilled
                                            </option>
                                            <option value="FULFILLED">Fulfilled</option>
                                        </select>
                                    </label>
                                    <label className="min-w-48 space-y-2 text-sm">
                                        Customer ID
                                        <input
                                            name="customerId"
                                            defaultValue={parsed.data.customerId ?? ''}
                                            placeholder="Optional organization customer ID"
                                            className="h-10 w-full rounded-md border bg-background px-3"
                                        />
                                    </label>
                                    <Button type="submit" variant="outline">
                                        Apply filters
                                    </Button>
                                </form>
                            }
                            emptyTitle="No sales orders found"
                            emptyDescription="Create a draft order or adjust the search and filters."
                            pagination={{
                                ...result.meta,
                                itemLabel: 'order',
                                previousHref:
                                    result.meta.page > 1
                                        ? pagesHref(
                                              current.organization.id,
                                              filterValues,
                                              result.meta.page - 1,
                                          )
                                        : undefined,
                                nextHref:
                                    result.meta.page < result.meta.totalPages
                                        ? pagesHref(
                                              current.organization.id,
                                              filterValues,
                                              result.meta.page + 1,
                                          )
                                        : undefined,
                            }}
                        />
                    </div>
                );
            }}
        />
    );
}
