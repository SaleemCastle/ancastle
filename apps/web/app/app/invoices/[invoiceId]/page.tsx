import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import {
    invoiceHistoryResponseSchema,
    invoiceResponseSchema,
    receivableInvoiceListResponseSchema,
    invoicePaymentAllocationsSchema,
} from '@ancastle/validation';
import { ManagementPage } from '@/components/management/page';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { formatJamaicaDate, formatJamaicaInstant, formatJmdAmount } from '@/lib/management/finance';

export const metadata: Metadata = { title: 'Invoice details | Ancastle Farms' };
const invoiceIdSchema = z.uuid();

export default function InvoiceDetailsPage({
    params,
    searchParams,
}: {
    params: Promise<{ invoiceId: string }>;
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/invoices"
            title="Invoice details"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('invoice:read'))
                    return (
                        <section className="space-y-3">
                            <h1 className="text-2xl font-semibold">Invoice details</h1>
                            <p role="alert">
                                You do not have permission to read invoices in this organization.
                            </p>
                        </section>
                    );
                const { invoiceId: rawId } = await params;
                const parsedId = invoiceIdSchema.safeParse(rawId);
                if (!parsedId.success) return <p role="alert">This invoice is unavailable.</p>;
                const id = parsedId.data;
                try {
                    const [invoiceResult, historyResult] = await Promise.all([
                        managementApi(
                            `organizations/${current.organization.id}/invoices/${id}`,
                            invoiceResponseSchema,
                        ),
                        managementApi(
                            `organizations/${current.organization.id}/invoices/${id}/history`,
                            invoiceHistoryResponseSchema,
                        ),
                    ]);
                    const invoice = invoiceResult.data;
                    const hasReceivables = current.permissions.includes('receivable:read');
                    const hasPayments = current.permissions.includes('payment:read');
                    const [balanceResult, allocationsResult] = await Promise.all([
                        hasReceivables
                            ? managementApi(
                                  `organizations/${current.organization.id}/receivables/invoices?invoiceId=${id}&page=1&pageSize=1`,
                                  receivableInvoiceListResponseSchema,
                              )
                            : Promise.resolve(null),
                        hasPayments
                            ? managementApi(
                                  `organizations/${current.organization.id}/payments/invoices/${id}/allocations`,
                                  invoicePaymentAllocationsSchema,
                              )
                            : Promise.resolve(null),
                    ]);
                    const receivable = balanceResult?.data[0];
                    return (
                        <div className="space-y-6">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <Link
                                        className="text-sm underline"
                                        href={applicationHref(
                                            '/app/invoices',
                                            current.organization.id,
                                        )}
                                    >
                                        ← Invoices
                                    </Link>
                                    <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                                        {invoice.invoiceNumber}
                                    </h1>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border px-3 py-1 text-sm">
                                            Issued
                                        </span>
                                        {receivable?.overdue && (
                                            <span className="rounded-full border border-destructive/40 px-3 py-1 text-sm font-medium text-destructive">
                                                Overdue
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-xl border bg-card p-4 text-right">
                                    <p className="text-sm text-muted-foreground">Invoice total</p>
                                    <p className="mt-1 text-xl font-semibold tabular-nums">
                                        {formatJmdAmount(invoice.grossAmount)}
                                    </p>
                                </div>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                                <section className="rounded-2xl border bg-card p-5">
                                    <h2 className="font-semibold">Customer snapshot</h2>
                                    <p className="mt-2 text-lg">
                                        {invoice.customerBillingSnapshot.name ||
                                            'Name not captured in the invoice snapshot'}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {invoice.customerBillingSnapshot.code}
                                    </p>
                                    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                                        <dt className="text-muted-foreground">Contact</dt>
                                        <dd>
                                            {invoice.customerBillingSnapshot.contactPerson ?? '—'}
                                        </dd>
                                        <dt className="text-muted-foreground">Phone</dt>
                                        <dd>{invoice.customerBillingSnapshot.phone ?? '—'}</dd>
                                        <dt className="text-muted-foreground">Email</dt>
                                        <dd>{invoice.customerBillingSnapshot.email ?? '—'}</dd>
                                        <dt className="text-muted-foreground">Billing address</dt>
                                        <dd>{invoice.customerBillingSnapshot.address ?? '—'}</dd>
                                    </dl>
                                    <p className="mt-4 text-xs text-muted-foreground">
                                        These values are the immutable billing details captured when
                                        the invoice was issued.
                                    </p>
                                </section>
                                <section className="rounded-2xl border bg-card p-5">
                                    <h2 className="font-semibold">Invoice terms</h2>
                                    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">Issue date</dt>
                                        <dd>{formatJamaicaInstant(invoice.issuedAt)}</dd>
                                        <dt className="text-muted-foreground">Due date</dt>
                                        <dd>{formatJamaicaDate(invoice.dueAt)}</dd>
                                        <dt className="text-muted-foreground">Payment terms</dt>
                                        <dd>
                                            {invoice.paymentTermsSnapshot.saleType === 'CASH'
                                                ? 'Cash'
                                                : `Credit · ${invoice.paymentTermsSnapshot.creditTermDays ?? '—'} days`}
                                        </dd>
                                        <dt className="text-muted-foreground">Source order</dt>
                                        <dd>
                                            <Link
                                                className="underline"
                                                href={applicationHref(
                                                    `/app/orders/${invoice.orderId}`,
                                                    current.organization.id,
                                                )}
                                            >
                                                {invoice.orderId}
                                            </Link>
                                        </dd>
                                        <dt className="text-muted-foreground">Source fulfilment</dt>
                                        <dd>{invoice.fulfilmentId}</dd>
                                    </dl>
                                </section>
                            </div>
                            <section className="space-y-4 rounded-2xl border bg-card p-5">
                                <div>
                                    <h2 className="font-semibold">Invoice lines</h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Descriptions, quantities, units and prices come from the
                                        invoice snapshot.
                                    </p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[600px] text-left text-sm">
                                        <caption className="sr-only">Invoice line items</caption>
                                        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <th className="p-3">Description</th>
                                                <th className="p-3 text-right">Quantity</th>
                                                <th className="p-3">Unit</th>
                                                <th className="p-3 text-right">Unit price</th>
                                                <th className="p-3 text-right">Line total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invoice.lines.map((line) => (
                                                <tr
                                                    key={line.id}
                                                    className="border-b last:border-0"
                                                >
                                                    <td className="p-3">{line.description}</td>
                                                    <td className="p-3 text-right tabular-nums">
                                                        {line.quantity}
                                                    </td>
                                                    <td className="p-3">{line.unit}</td>
                                                    <td className="p-3 text-right tabular-nums">
                                                        JMD {line.unitPrice}
                                                    </td>
                                                    <td className="p-3 text-right tabular-nums">
                                                        {formatJmdAmount(line.lineAmount)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 text-sm">
                                    <dt>Subtotal</dt>
                                    <dd className="text-right tabular-nums">
                                        {formatJmdAmount(invoice.grossAmount)}
                                    </dd>
                                    <dt className="font-semibold">Invoice total</dt>
                                    <dd className="text-right font-semibold tabular-nums">
                                        {formatJmdAmount(invoice.grossAmount)}
                                    </dd>
                                </dl>
                                <div className="rounded-xl bg-muted p-4 text-sm">
                                    <h3 className="font-medium">Tax policy</h3>
                                    <p className="mt-1">
                                        {invoice.taxTreatmentStatus ===
                                        'APPROVED_POLICY_NOT_CALCULATED'
                                            ? 'Approved policy recorded; tax has not been calculated on this invoice.'
                                            : 'Tax policy is pending.'}
                                    </p>
                                    <p className="mt-1 text-muted-foreground">
                                        Reference: {invoice.taxPolicyReference ?? 'Not recorded'} ·
                                        Version: {invoice.taxPolicyVersion ?? 'Not recorded'}
                                    </p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        The invoice API does not provide a separate tax amount. The
                                        displayed total is the backend stored amount.
                                    </p>
                                </div>
                            </section>
                            <section className="grid gap-4 lg:grid-cols-2">
                                <article className="rounded-2xl border bg-card p-5">
                                    <h2 className="font-semibold">Receivables</h2>
                                    {receivable ? (
                                        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                                            <dt>Settlement</dt>
                                            <dd className="text-right">
                                                {receivable.status === 'PAID'
                                                    ? 'Settled'
                                                    : receivable.status === 'PARTIALLY_PAID'
                                                      ? 'Partially settled'
                                                      : 'Unpaid'}
                                            </dd>
                                            <dt>Allocated</dt>
                                            <dd className="text-right tabular-nums">
                                                {formatJmdAmount(receivable.allocatedAmount)}
                                            </dd>
                                            <dt>Outstanding</dt>
                                            <dd className="text-right font-semibold tabular-nums">
                                                {formatJmdAmount(receivable.outstandingAmount)}
                                            </dd>
                                            <dt>Days overdue</dt>
                                            <dd className="text-right">{receivable.daysOverdue}</dd>
                                        </dl>
                                    ) : (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Receivables details are restricted to users with
                                            receivables access.
                                        </p>
                                    )}
                                </article>
                                <article className="rounded-2xl border bg-card p-5">
                                    <h2 className="font-semibold">Allocated payments</h2>
                                    {allocationsResult ? (
                                        allocationsResult.data.length ? (
                                            <ul className="mt-3 divide-y">
                                                {allocationsResult.data.map((allocation) => (
                                                    <li
                                                        key={allocation.allocationId}
                                                        className="grid grid-cols-[1fr_auto] gap-2 py-3 text-sm"
                                                    >
                                                        <span>
                                                            <span className="block font-medium">
                                                                Payment {allocation.paymentId}
                                                            </span>
                                                            <span className="text-muted-foreground">
                                                                {allocation.paymentMethod.replace(
                                                                    '_',
                                                                    ' ',
                                                                )}{' '}
                                                                ·{' '}
                                                                {formatJamaicaInstant(
                                                                    allocation.paymentRecordedAt,
                                                                )}
                                                                {allocation.reversedAt
                                                                    ? ' · Reversed'
                                                                    : ''}
                                                            </span>
                                                        </span>
                                                        <span className="text-right tabular-nums">
                                                            <span className="block">
                                                                {formatJmdAmount(allocation.amount)}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                Active{' '}
                                                                {formatJmdAmount(
                                                                    allocation.activeAmount,
                                                                )}
                                                            </span>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                No payment allocations are recorded.
                                            </p>
                                        )
                                    ) : (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Payment allocation details are restricted to users with
                                            payment read access.
                                        </p>
                                    )}
                                </article>
                            </section>
                            <section className="rounded-2xl border bg-card p-5">
                                <h2 className="font-semibold">Invoice history</h2>
                                <ol className="mt-3 space-y-3">
                                    {historyResult.data.map((event) => (
                                        <li
                                            key={event.id}
                                            className="flex flex-wrap justify-between gap-2 border-l-2 pl-3 text-sm"
                                        >
                                            <span>{event.type.replaceAll('_', ' ')}</span>
                                            <time
                                                className="text-muted-foreground"
                                                dateTime={event.createdAt}
                                            >
                                                {formatJamaicaInstant(event.createdAt)}
                                            </time>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        </div>
                    );
                } catch (error) {
                    return (
                        <section className="space-y-3 rounded-2xl border border-destructive/30 bg-card p-5">
                            <h1 className="text-2xl font-semibold">Invoice unavailable</h1>
                            <p role="alert">
                                {error instanceof ManagementApiError
                                    ? error.message
                                    : 'Invoice details could not be loaded.'}
                            </p>
                            <Link
                                className="underline"
                                href={applicationHref(
                                    `/app/invoices/${id}`,
                                    current.organization.id,
                                )}
                            >
                                Retry
                            </Link>
                            <Link
                                className="ml-4 underline"
                                href={applicationHref('/app/invoices', current.organization.id)}
                            >
                                Back to invoices
                            </Link>
                        </section>
                    );
                }
            }}
        />
    );
}
