import type { Metadata } from 'next';
import Link from 'next/link';
import { paymentResponseSchema, resourceIdSchema } from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { PaymentDate, PaymentStatusBadge } from '@/components/payments/payment-display';
import { PaymentDetailActions } from '@/components/payments/payment-forms';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { managementApi } from '@/lib/management/api';
import { formatJamaicaInstant, formatJmdAmount } from '@/lib/management/finance';
import { paymentActions, paymentMethodLabels, paymentReference } from '@/lib/management/payments';

export const metadata: Metadata = { title: 'Payment details | Ancastle Farms' };
const eventLabels = { RECORDED: 'Recorded', VERIFIED: 'Verified', REVERSED: 'Reversed' };

export default function PaymentPage({
    params,
    searchParams,
}: {
    params: Promise<{ paymentId: string }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/payments"
            title="Payment details"
            render={async (context) => {
                const current = context.current!;
                const organization = current.organization.id;
                const listHref = applicationHref('/app/payments', organization);
                if (!current.permissions.includes('payment:read'))
                    return (
                        <p role="alert">
                            You do not have permission to read payments in this organization.
                        </p>
                    );
                const parsed = resourceIdSchema.safeParse((await params).paymentId);
                if (!parsed.success)
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Payment unavailable</h1>
                            <Link className="underline" href={listHref}>
                                Back to payments
                            </Link>
                        </section>
                    );
                const { data: payment } = await managementApi(
                    `organizations/${organization}/payments/${parsed.data}`,
                    paymentResponseSchema,
                );
                const allowed = paymentActions(
                    payment,
                    current.permissions,
                    current.membership.role,
                );
                const fields = [
                    ['Payment method', paymentMethodLabels[payment.method]],
                    ['Payment date', <PaymentDate key="date" payment={payment} />],
                    ['Amount', formatJmdAmount(payment.amount)],
                    ['Allocated', formatJmdAmount(payment.allocatedAmount)],
                    ['Unallocated', formatJmdAmount(payment.unallocatedAmount)],
                    ...(payment.method === 'BANK_TRANSFER'
                        ? [
                              [
                                  'Receiving bank account',
                                  payment.receivingAccount ?? 'Unavailable for this transfer',
                              ],
                          ]
                        : []),
                ];
                return (
                    <div className="space-y-5">
                        <Link href={listHref} prefetch={false} className="text-sm underline">
                            Back to payments
                        </Link>
                        <header className="space-y-2">
                            <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight">
                                {paymentReference(payment)}
                            </h1>
                            <p className="wrap-anywhere text-sm text-muted-foreground">
                                {payment.customerName ?? payment.customerId}
                            </p>
                            <PaymentStatusBadge status={payment.status} />
                        </header>
                        <dl className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
                            {fields.map(([label, value]) => (
                                <div key={String(label)} className="min-w-0">
                                    <dt className="text-sm text-muted-foreground">{label}</dt>
                                    <dd className="wrap-anywhere font-medium">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {payment.status === 'PENDING_VERIFICATION' && (
                            <p className="text-sm text-muted-foreground">
                                These funds are available for allocation after verification.
                            </p>
                        )}
                        {current.membership.role === 'MANAGER' &&
                            current.permissions.includes('payment:verify') &&
                            payment.recordedByCurrentMember &&
                            payment.status === 'PENDING_VERIFICATION' && (
                                <p className="text-sm text-muted-foreground">
                                    Ask another authorized member to verify this payment.
                                </p>
                            )}
                        <PaymentDetailActions
                            key={organization + ':' + context.user.id + ':' + payment.id}
                            organization={organization}
                            actor={context.user.id}
                            payment={payment}
                            allowed={allowed}
                        />

                        <section
                            className="space-y-3 rounded-2xl border border-border bg-card p-4"
                            aria-labelledby="payment-history"
                        >
                            <h2 id="payment-history" className="text-lg font-semibold">
                                Payment history
                            </h2>
                            <ol className="divide-y text-sm">
                                {payment.events.map((event) => (
                                    <li key={event.id} className="space-y-1 py-3">
                                        <p className="font-medium">
                                            {eventLabels[event.type]}
                                            {event.selfVerification ? ' by the recorder' : ''}
                                        </p>
                                        <p className="text-muted-foreground">
                                            {formatJamaicaInstant(event.createdAt)} / Membership{' '}
                                            {event.actorMembershipId}
                                        </p>
                                        {event.reason && (
                                            <p className="wrap-anywhere whitespace-pre-wrap">
                                                {event.reason}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        </section>
                        <section
                            className="space-y-3 rounded-2xl border border-border bg-card p-4"
                            aria-labelledby="allocation-history"
                        >
                            <h2 id="allocation-history" className="text-lg font-semibold">
                                Invoice allocation history
                            </h2>
                            {payment.allocations.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No allocations for this payment.
                                </p>
                            ) : (
                                <ul className="divide-y text-sm">
                                    {payment.allocations.map((allocation) => (
                                        <li
                                            key={allocation.id}
                                            className="flex flex-wrap justify-between gap-2 py-3"
                                        >
                                            <div className="min-w-0 wrap-anywhere">
                                                {current.permissions.includes('invoice:read') ? (
                                                    <Link
                                                        className="underline"
                                                        href={applicationHref(
                                                            '/app/invoices/' + allocation.invoiceId,
                                                            organization,
                                                        )}
                                                        prefetch={false}
                                                    >
                                                        Invoice {allocation.invoiceId}
                                                    </Link>
                                                ) : (
                                                    <p>Invoice {allocation.invoiceId}</p>
                                                )}
                                                <p className="text-muted-foreground">
                                                    {formatJamaicaInstant(allocation.createdAt)}
                                                </p>
                                            </div>
                                            <div className="min-w-0 wrap-anywhere">
                                                <p className="font-medium">
                                                    {formatJmdAmount(allocation.amount)}
                                                </p>
                                                <p className="text-muted-foreground">
                                                    {allocation.reversedAt
                                                        ? 'Unwound ' +
                                                          formatJamaicaInstant(
                                                              allocation.reversedAt,
                                                          )
                                                        : 'Active'}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </div>
                );
            }}
        />
    );
}
