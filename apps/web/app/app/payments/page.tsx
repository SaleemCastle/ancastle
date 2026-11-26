import type { Metadata } from 'next';
import Link from 'next/link';
import { paymentListResponseSchema, paymentQuerySchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { CustomerPicker } from '@/components/payments/customer-picker';
import { RecordPayment } from '@/components/payments/payment-forms';
import { PaymentStatusBadge, PaymentDate } from '@/components/payments/payment-display';
import { Button, buttonVariants } from '@/components/ui/button';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { customerListResponseSchema, managementApi } from '@/lib/management/api';
import { formatJmdAmount } from '@/lib/management/finance';
import { paymentActions, paymentMethodLabels, paymentReference } from '@/lib/management/payments';

export const metadata: Metadata = { title: 'Payments | Ancastle Farms' };
const path = '/app/payments';
const columns = [
    'Reference',
    'Customer',
    'Method',
    'Amount',
    'Status',
    'Allocated',
    'Unallocated',
    'Payment date',
    'Actions',
];

export default function PaymentsPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath={path}
            title="Payments"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('payment:read'))
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Payments</h1>
                            <p role="alert">
                                You do not have permission to read payments in this organization.
                            </p>
                        </section>
                    );

                const organization = current.organization.id;
                const listHref = applicationHref(path, organization);
                const parsed = paymentQuerySchema.safeParse({
                    customerId: search.customerId === '' ? undefined : search.customerId,
                    page: search.page,
                    pageSize: search.pageSize,
                });
                if (!parsed.success)
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Payments</h1>
                            <p role="alert">The customer or page filter is invalid.</p>
                            <Link href={listHref} className="underline">
                                Clear filters
                            </Link>
                        </section>
                    );

                const { customerId, page, pageSize } = parsed.data;
                const query = new URLSearchParams({
                    page: String(page),
                    pageSize: String(pageSize),
                });
                if (customerId) query.set('customerId', customerId);
                const base = `organizations/${organization}`;
                const [payments, customers] = await Promise.all([
                    managementApi(`${base}/payments?${query}`, paymentListResponseSchema),
                    current.permissions.includes('customer:read')
                        ? managementApi(
                              `${base}/customers?page=1&pageSize=20`,
                              customerListResponseSchema,
                          )
                        : null,
                ]);
                const choices = customers
                    ? {
                          data: customers.data.map(({ id, name, code }) => ({ id, name, code })),
                          totalPages: customers.meta.totalPages,
                      }
                    : null;
                const selected = customerId
                    ? (choices?.data.find((customer) => customer.id === customerId) ?? {
                          id: customerId,
                          name: payments.data[0]?.customerName ?? 'Selected customer',
                          code: '',
                      })
                    : undefined;
                const { meta } = payments;
                function pageHref(next: number) {
                    const nextQuery = new URLSearchParams(query);
                    nextQuery.set('page', String(next));
                    return listHref + '&' + nextQuery;
                }

                return (
                    <div className="space-y-5">
                        <header className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Review payment evidence and verified funds for{' '}
                                    {current.organization.name}.
                                </p>
                            </div>
                            {choices && current.permissions.includes('payment:record') && (
                                <RecordPayment
                                    key={organization + ':' + context.user.id}
                                    organization={organization}
                                    actor={context.user.id}
                                    customers={choices}
                                />
                            )}
                        </header>
                        <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
                            {choices && (
                                <form
                                    action={path}
                                    role="search"
                                    aria-label="Filter payments"
                                    className="flex flex-wrap items-end gap-3"
                                >
                                    <input type="hidden" name="organization" value={organization} />
                                    <CustomerPicker
                                        key={organization + ':' + (customerId ?? '')}
                                        organization={organization}
                                        initial={choices}
                                        selected={selected}
                                    />
                                    <Button type="submit" variant="outline">
                                        Filter payments
                                    </Button>
                                    {customerId && (
                                        <Link
                                            className={buttonVariants({ variant: 'ghost' })}
                                            href={listHref}
                                        >
                                            Clear filter
                                        </Link>
                                    )}
                                </form>
                            )}

                            {payments.data.length === 0 ? (
                                <p className="rounded-xl bg-muted p-4 text-sm">
                                    No payments on this page.
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <caption className="sr-only">Organization payments</caption>
                                        <thead className="max-xl:sr-only">
                                            <tr className="border-b text-muted-foreground">
                                                {columns.map((column) => (
                                                    <th
                                                        scope="col"
                                                        className="px-2 py-3"
                                                        key={column}
                                                    >
                                                        {column}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="max-xl:grid max-xl:gap-3 md:max-xl:grid-cols-2">
                                            {payments.data.map((payment) => {
                                                const detail = applicationHref(
                                                    path + '/' + payment.id,
                                                    organization,
                                                );
                                                const allowed = paymentActions(
                                                    payment,
                                                    current.permissions,
                                                    current.membership.role,
                                                );
                                                const cells = [
                                                    <Link
                                                        key="reference"
                                                        href={detail}
                                                        prefetch={false}
                                                        className="font-semibold underline underline-offset-4"
                                                    >
                                                        {paymentReference(payment)}
                                                    </Link>,
                                                    payment.customerName ?? payment.customerId,
                                                    paymentMethodLabels[payment.method],
                                                    formatJmdAmount(payment.amount),
                                                    <PaymentStatusBadge
                                                        key="status"
                                                        status={payment.status}
                                                    />,
                                                    formatJmdAmount(payment.allocatedAmount),
                                                    <div key="unallocated">
                                                        {formatJmdAmount(payment.unallocatedAmount)}
                                                        {payment.status ===
                                                            'PENDING_VERIFICATION' && (
                                                            <span className="block text-xs text-muted-foreground">
                                                                Available after verification
                                                            </span>
                                                        )}
                                                    </div>,
                                                    <PaymentDate key="date" payment={payment} />,
                                                    <div
                                                        key="actions"
                                                        className="flex flex-wrap gap-x-2 gap-y-1"
                                                    >
                                                        {allowed.verify && (
                                                            <Link
                                                                href={detail + '#verify-payment'}
                                                                prefetch={false}
                                                                className="underline"
                                                            >
                                                                Verify
                                                            </Link>
                                                        )}
                                                        {allowed.allocate && (
                                                            <Link
                                                                href={detail + '#allocate-payment'}
                                                                prefetch={false}
                                                                className="underline"
                                                            >
                                                                Allocate
                                                            </Link>
                                                        )}
                                                        {allowed.reverse && (
                                                            <Link
                                                                href={detail + '#reverse-payment'}
                                                                prefetch={false}
                                                                className="underline"
                                                            >
                                                                Reverse
                                                            </Link>
                                                        )}
                                                        {!allowed.verify &&
                                                            !allowed.allocate &&
                                                            !allowed.reverse && (
                                                                <Link
                                                                    href={detail}
                                                                    prefetch={false}
                                                                    className="underline"
                                                                >
                                                                    View
                                                                </Link>
                                                            )}
                                                    </div>,
                                                ];
                                                return (
                                                    <tr
                                                        key={payment.id}
                                                        className="xl:border-b xl:last:border-0 max-xl:grid max-xl:gap-2 max-xl:rounded-xl max-xl:border max-xl:p-3"
                                                    >
                                                        {cells.map((cell, index) => (
                                                            <td
                                                                key={columns[index]}
                                                                className="min-w-0 wrap-anywhere align-top xl:px-2 xl:py-3 max-xl:grid max-xl:grid-cols-[minmax(5.5rem,0.65fr)_minmax(0,1fr)] max-xl:gap-2"
                                                            >
                                                                <span
                                                                    aria-hidden
                                                                    className="text-xs text-muted-foreground xl:hidden"
                                                                >
                                                                    {columns[index]}
                                                                </span>
                                                                <div className="min-w-0">
                                                                    {cell}
                                                                </div>
                                                            </td>
                                                        ))}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <nav
                                aria-label="Payment pages"
                                className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
                            >
                                <p>
                                    {meta.totalItems}{' '}
                                    {meta.totalItems === 1 ? 'payment' : 'payments'} / Page{' '}
                                    {meta.page} of {Math.max(1, meta.totalPages)}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {meta.page > 1 && (
                                        <Link
                                            href={pageHref(meta.page - 1)}
                                            className={buttonVariants({ variant: 'outline' })}
                                        >
                                            Previous
                                        </Link>
                                    )}
                                    {meta.page < meta.totalPages && (
                                        <Link
                                            href={pageHref(meta.page + 1)}
                                            className={buttonVariants({ variant: 'outline' })}
                                        >
                                            Next
                                        </Link>
                                    )}
                                </div>
                            </nav>
                        </section>
                    </div>
                );
            }}
        />
    );
}
