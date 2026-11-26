'use client';

import { useEffect, useState } from 'react';
import type { Payment } from '@ancastle/types';
import { loadAllocationInvoices } from '@/app/app/payments/actions';
import { Button } from '@/components/ui/button';
import { formatJmdAmount } from '@/lib/management/finance';
import {
    allocationError,
    normalizePaymentAmount,
    paymentActions,
    paymentReference,
} from '@/lib/management/payments';
import { CustomerPicker, paymentInput, type CustomerPage } from './customer-picker';
import { PaymentCommandDialog } from './command-dialog';

export function RecordPayment({
    organization,
    actor,
    customers,
}: {
    organization: string;
    actor: string;
    customers: CustomerPage;
}) {
    const [method, setMethod] = useState('CASH');
    return (
        <PaymentCommandDialog
            command="record"
            organization={organization}
            actor={actor}
            label="Record payment"
            description="Enter the payment evidence and transaction date in Jamaica. The payment will wait for verification."
            confirmation="I have checked the customer, amount and payment evidence."
            payload={(form) => {
                const amount = normalizePaymentAmount(String(form.get('amount')));
                if (!amount)
                    return { error: 'Enter a positive JMD amount with up to two decimal places.' };
                const base = {
                    customerId: form.get('customerId'),
                    amount,
                    transactionDate: form.get('transactionDate'),
                };
                const reference = String(form.get('reference') ?? '').trim();
                if (!reference)
                    return { error: 'Enter a receipt number or bank transfer reference.' };
                if (method === 'CASH')
                    return { data: { ...base, method, cashReceiptNumber: reference } };
                const receivingAccount = String(form.get('receivingAccount') ?? '').trim();
                if (!receivingAccount) return { error: 'Enter the receiving bank account.' };
                return {
                    data: { ...base, method, receivingAccount, bankTransferReference: reference },
                };
            }}
        >
            <CustomerPicker organization={organization} initial={customers} required />
            <label className="block space-y-1 text-sm font-medium">
                Payment method
                <select
                    name="method"
                    className={paymentInput}
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-sm font-medium">
                    Amount (JMD)
                    <input
                        name="amount"
                        className={paymentInput}
                        inputMode="decimal"
                        maxLength={35}
                        required
                    />
                </label>
                <label className="block space-y-1 text-sm font-medium">
                    Transaction date (Jamaica)
                    <input
                        name="transactionDate"
                        className={paymentInput}
                        type="date"
                        min="0001-01-01"
                        max="9999-12-31"
                        required
                    />
                </label>
            </div>
            <label className="block space-y-1 text-sm font-medium" key={method}>
                {method === 'CASH' ? 'Cash receipt number' : 'Bank transfer reference'}
                <input name="reference" className={paymentInput} maxLength={200} required />
            </label>
            {method === 'BANK_TRANSFER' && (
                <label className="block space-y-1 text-sm font-medium">
                    Receiving bank account
                    <input
                        name="receivingAccount"
                        className={paymentInput}
                        maxLength={200}
                        autoComplete="off"
                        required
                    />
                </label>
            )}
        </PaymentCommandDialog>
    );
}

type Invoice = { invoiceId: string; invoiceNumber: string; outstandingAmount: string };
type BalanceStatus = 'UNPAID' | 'PARTIALLY_PAID';

function AllocationFields({
    organization,
    payment,
    onReload,
}: {
    organization: string;
    payment: Payment;
    onReload: () => void;
}) {
    const [status, setStatus] = useState<BalanceStatus>('UNPAID');
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<{
        status: BalanceStatus;
        page: number;
        revision: number;
        invoices?: Invoice[];
        totalPages?: number;
        available?: string;
        error?: string;
    }>();
    const [selected, setSelected] = useState<Invoice[]>([]);
    const paymentId = payment.id;
    useEffect(() => {
        let active = true;
        loadAllocationInvoices(organization, paymentId, status, page)
            .then((result) => {
                if (!active) return;
                setLoaded({
                    status,
                    page,
                    revision,
                    invoices: result.data,
                    totalPages: result.totalPages,
                    available: result.available,
                    error: result.error,
                });
            })
            .catch(() => {
                if (active)
                    setLoaded({
                        status,
                        page,
                        revision,
                        error: 'The invoice balances could not be loaded.',
                    });
            });
        return () => {
            active = false;
        };
    }, [organization, paymentId, status, page, revision]);

    const current =
        loaded?.status === status && loaded.page === page && loaded.revision === revision
            ? loaded
            : undefined;
    const available = current?.available ?? loaded?.available ?? payment.unallocatedAmount;
    return (
        <div className="space-y-3">
            <p className="break-all text-sm">
                Verified funds available <strong>{formatJmdAmount(available)}</strong>
            </p>
            <input type="hidden" name="available" value={current?.available ?? ''} />
            <div className="flex flex-wrap gap-2">
                <label className="flex-1 text-sm font-medium">
                    Invoice settlement status
                    <select
                        className={paymentInput}
                        value={status}
                        onChange={(event) => {
                            setStatus(
                                event.target.value === 'PARTIALLY_PAID'
                                    ? 'PARTIALLY_PAID'
                                    : 'UNPAID',
                            );
                            setPage(1);
                        }}
                    >
                        <option value="UNPAID">Unpaid</option>
                        <option value="PARTIALLY_PAID">Partially settled</option>
                    </select>
                </label>
                <Button
                    className="self-end"
                    type="button"
                    variant="outline"
                    onClick={() => {
                        onReload();
                        setSelected([]);
                        setRevision((value) => value + 1);
                    }}
                >
                    Reload balances
                </Button>
            </div>
            {!current && <p role="status">Loading outstanding invoices...</p>}
            {current?.error && (
                <p role="alert" className="text-sm text-destructive">
                    {current.error}
                </p>
            )}
            {current?.invoices?.length === 0 && (
                <p className="text-sm text-muted-foreground">No eligible invoices on this page.</p>
            )}
            {current?.invoices?.map((invoice) => (
                <div
                    key={invoice.invoiceId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                    <p className="min-w-0 break-all">
                        {invoice.invoiceNumber}{' '}
                        <strong>{formatJmdAmount(invoice.outstandingAmount)}</strong> outstanding
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                            selected.length >= 100 ||
                            selected.some((item) => item.invoiceId === invoice.invoiceId)
                        }
                        onClick={() => setSelected((items) => [...items, invoice])}
                        aria-label={'Add invoice ' + invoice.invoiceNumber}
                    >
                        Add invoice
                    </Button>
                </div>
            ))}
            {(page > 1 || page < (current?.totalPages ?? 0)) && (
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!current || page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        Previous invoices
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!current || page >= (current.totalPages ?? 0)}
                        onClick={() => setPage(page + 1)}
                    >
                        Next invoices
                    </Button>
                </div>
            )}
            {selected.length > 0 && <h3 className="text-sm font-semibold">Selected allocations</h3>}
            {selected.map((invoice) => (
                <div key={invoice.invoiceId} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="invoice" value={invoice.invoiceId} />
                    <input type="hidden" name="outstanding" value={invoice.outstandingAmount} />
                    <label className="min-w-0 flex-1 text-sm font-medium">
                        Allocation for {invoice.invoiceNumber}
                        <span className="block break-all text-xs text-muted-foreground">
                            {formatJmdAmount(invoice.outstandingAmount)} outstanding
                        </span>
                        <input
                            name="allocation"
                            className={paymentInput}
                            inputMode="decimal"
                            maxLength={35}
                            required
                        />
                    </label>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={'Remove invoice ' + invoice.invoiceNumber}
                        onClick={() =>
                            setSelected((items) =>
                                items.filter((item) => item.invoiceId !== invoice.invoiceId),
                            )
                        }
                    >
                        Remove
                    </Button>
                </div>
            ))}
        </div>
    );
}

export function PaymentDetailActions({
    organization,
    actor,
    payment,
    allowed,
}: {
    organization: string;
    actor: string;
    payment: Payment;
    allowed: ReturnType<typeof paymentActions>;
}) {
    const [success, setSuccess] = useState('');
    type Action = keyof typeof allowed;
    const [error, setError] = useState<{ command: Action; message: string } | null>(null);
    const scope = {
        organization,
        actor,
        payment: payment.id,
        onSuccess: (message: string) => {
            setError(null);
            setSuccess(message);
        },
        onError: (command: Action | 'record', message: string) => {
            setSuccess('');
            if (command !== 'record') setError({ command, message });
        },
    };
    const reference = paymentReference(payment);
    return (
        <section aria-label="Payment actions" className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {allowed.verify && (
                    <PaymentCommandDialog
                        {...scope}
                        command="verify"
                        label="Verify payment"
                        description={`Confirm that ${formatJmdAmount(payment.amount)} for ${reference} was received.`}
                        confirmation="I have confirmed receipt of these funds."
                        payload={() => ({ data: {} })}
                    />
                )}
                {allowed.allocate && (
                    <PaymentCommandDialog
                        {...scope}
                        command="allocate"
                        label="Allocate payment"
                        description="Apply verified funds to outstanding invoices. Any remaining funds stay available for later allocation."
                        confirmation="I have reviewed the selected invoices and amounts."
                        payload={(form) => {
                            const amounts = form.getAll('allocation');
                            const outstanding = form.getAll('outstanding');
                            const rows = form.getAll('invoice').map((invoice, index) => ({
                                invoiceId: String(invoice),
                                amount: String(amounts[index]),
                                outstanding: String(outstanding[index]),
                            }));
                            const available = String(form.get('available') ?? '');
                            if (!available)
                                return {
                                    error: 'Load the current invoice balances before submitting.',
                                };
                            const error = allocationError(rows, available);
                            if (error) return { error };
                            return {
                                data: {
                                    allocations: rows
                                        .map(({ invoiceId, amount }) => ({
                                            invoiceId,
                                            amount: normalizePaymentAmount(amount),
                                        }))
                                        .sort((left, right) =>
                                            left.invoiceId.localeCompare(right.invoiceId),
                                        ),
                                },
                            };
                        }}
                    >
                        {(clearError) => (
                            <AllocationFields
                                organization={organization}
                                payment={payment}
                                onReload={clearError}
                            />
                        )}
                    </PaymentCommandDialog>
                )}
                {allowed.reverse && (
                    <PaymentCommandDialog
                        {...scope}
                        command="reverse"
                        label="Reverse payment"
                        description={`Reversing ${reference} unwinds all active invoice allocations and restores those invoice balances. The reversal is permanent.`}
                        confirmation="I understand the effect on the payment and invoice balances."
                        payload={(form) => {
                            const reason = String(form.get('reason') ?? '').trim();
                            return reason
                                ? { data: { reason } }
                                : { error: 'Enter a reversal reason.' };
                        }}
                    >
                        <label className="block space-y-1 text-sm font-medium">
                            Reversal reason
                            <textarea
                                name="reason"
                                className={paymentInput}
                                required
                                maxLength={500}
                                rows={3}
                            />
                        </label>
                    </PaymentCommandDialog>
                )}
            </div>
            {success && (
                <p role="status" className="text-sm">
                    {success}
                </p>
            )}
            {error && !allowed[error.command] && (
                <p role="alert" className="text-sm text-destructive">
                    {error.message}
                </p>
            )}
        </section>
    );
}
