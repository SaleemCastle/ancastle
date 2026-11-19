import type { Metadata } from 'next';
import Link from 'next/link';
import { resourceIdSchema } from '@ancastle/validation';
import { customerResponseSchema, managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { CustomerForm, CustomerStatusForm } from '@/components/customers/forms';
import { MasterDataStatus } from '@/components/management/master-data-list';
import {
    customerOrderHistoryResponseSchema,
    customerOrderHistoryQuerySchema,
} from '@ancastle/validation';
import { formatJmdAmount } from '@/lib/management/order-form';

export const metadata: Metadata = {
    title: 'Customer details | Ancastle Farms',
};

export default function CustomerPage({
    searchParams,
    params,
}: {
    searchParams: Promise<ApplicationSearch>;
    params: Promise<{ customerId: string }>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/customers"
            title="Customer details"
            render={async (context, search) => {
                const current = context.current!;

                if (!current.permissions.includes('customer:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                const id = resourceIdSchema.safeParse((await params).customerId);

                if (!id.success) {
                    throw new ManagementApiError('CUSTOMER_NOT_FOUND');
                }

                const { data } = await managementApi(
                    'organizations/' + current.organization.id + '/customers/' + id.data,
                    customerResponseSchema,
                );
                const historyQuery = customerOrderHistoryQuerySchema.safeParse({
                    page: search.page ?? 1,
                    pageSize: 20,
                });
                if (!historyQuery.success) throw new ManagementApiError('VALIDATION_ERROR');
                const history = current.permissions.includes('order:read')
                    ? await managementApi(
                          `organizations/${current.organization.id}/customers/${data.id}/orders?page=${historyQuery.data.page}&pageSize=${historyQuery.data.pageSize}`,
                          customerOrderHistoryResponseSchema,
                      )
                    : null;

                const canEdit = current.permissions.includes('customer:update');

                const canChangeStatus = current.permissions.includes('customer:deactivate');

                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/customers', current.organization.id)}
                            className="text-sm underline"
                        >
                            Back to customers
                        </Link>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <h1 className="wrap-break-word text-2xl font-semibold">{data.name}</h1>

                            <MasterDataStatus isActive={data.isActive} />
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span>Code: {data.code}</span>
                            <span>
                                Type: {data.type === 'BUSINESS' ? 'Business' : 'Individual'}
                            </span>
                        </div>

                        {canEdit ? (
                            <CustomerForm
                                mode="update"
                                organization={current.organization.id}
                                customerId={data.id}
                                type={data.type}
                                name={data.name}
                                contactPerson={data.contactPerson}
                                phone={data.phone}
                                email={data.email}
                                address={data.address}
                                notes={data.notes}
                            />
                        ) : (
                            <section
                                aria-label="Customer details"
                                className="mt-6 max-w-2xl space-y-4 rounded-xl border p-5"
                            >
                                <div>
                                    <p className="text-sm font-medium">Contact person</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {data.contactPerson || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Phone</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {data.phone || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Email</p>
                                    <p className="mt-1 break-all text-sm text-muted-foreground">
                                        {data.email || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Address</p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                        {data.address || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Notes</p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                        {data.notes || 'Not provided'}
                                    </p>
                                </div>

                                <p className="border-t pt-4 text-sm text-muted-foreground">
                                    Your access to this customer is read-only.
                                </p>
                            </section>
                        )}

                        {canChangeStatus && (
                            <CustomerStatusForm
                                organization={current.organization.id}
                                customerId={data.id}
                                isActive={data.isActive}
                            />
                        )}
                        <section aria-label="Customer purchase history" className="mt-8 space-y-4">
                            <h2 className="text-xl font-semibold">Order and purchase history</h2>
                            {!history ? (
                                <p className="rounded-xl border p-5">
                                    Order history is not available with your current permissions.
                                </p>
                            ) : history.data.length === 0 ? (
                                <p className="rounded-xl border p-5">
                                    This customer has no orders yet.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {history.data.map((order) => (
                                        <article key={order.id} className="rounded-xl border p-4">
                                            <div className="flex flex-wrap justify-between gap-2">
                                                <div>
                                                    <h3 className="font-semibold">
                                                        {order.code} · {order.commercialState}
                                                    </h3>
                                                    <p className="text-sm text-muted-foreground">
                                                        Created{' '}
                                                        {new Date(order.createdAt).toLocaleString(
                                                            'en-JM',
                                                        )}{' '}
                                                        · Confirmed{' '}
                                                        {order.confirmedAt
                                                            ? new Date(
                                                                  order.confirmedAt,
                                                              ).toLocaleString('en-JM')
                                                            : 'not confirmed'}
                                                    </p>
                                                </div>
                                                <p className="font-medium">
                                                    Commercial snapshot{' '}
                                                    {formatJmdAmount(order.totalAmount)}{' '}
                                                    {order.currency}
                                                </p>
                                            </div>
                                            <p className="mt-1 text-sm">
                                                Physical fulfilment:{' '}
                                                {order.fulfilmentProgress?.replaceAll('_', ' ') ??
                                                    'Not started'}
                                            </p>
                                            <ul className="mt-3 space-y-2">
                                                {order.lines.map((line) => (
                                                    <li
                                                        key={line.id}
                                                        className="rounded-md bg-muted/50 p-3 text-sm"
                                                    >
                                                        <span className="font-medium">
                                                            {line.productName}
                                                        </span>{' '}
                                                        · Ordered {line.orderedQuantity} {line.unit}{' '}
                                                        · Net purchased {line.fulfilledQuantity}{' '}
                                                        {line.unit} · Remaining{' '}
                                                        {line.remainingQuantity} {line.unit}
                                                        <span className="block text-muted-foreground">
                                                            Unit price snapshot JMD {line.unitPrice}{' '}
                                                            · line total{' '}
                                                            {formatJmdAmount(line.lineAmount)}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            <Link
                                                prefetch={false}
                                                className="mt-3 inline-block underline"
                                                href={applicationHref(
                                                    `/app/orders/${order.id}`,
                                                    current.organization.id,
                                                )}
                                            >
                                                Open order
                                            </Link>
                                        </article>
                                    ))}
                                </div>
                            )}
                            <p className="text-sm text-muted-foreground">
                                Commercial amounts and CASH/CREDIT terms are order snapshots. This
                                history does not show payments, invoices, balances or receivables.
                            </p>
                        </section>
                    </>
                );
            }}
        />
    );
}
