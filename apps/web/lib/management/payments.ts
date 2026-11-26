import type { Payment } from '@ancastle/types';

export const paymentStatusLabels = {
    PENDING_VERIFICATION: 'Pending verification',
    VERIFIED: 'Verified',
    REVERSED: 'Reversed',
} satisfies Record<Payment['status'], string>;

export const paymentMethodLabels = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer' };

export function paymentReference(payment: Payment) {
    return payment.method === 'CASH' ? payment.cashReceiptNumber : payment.bankTransferReference;
}

export function paymentActions(payment: Payment, permissions: readonly string[], role: string) {
    return {
        verify:
            permissions.includes('payment:verify') &&
            payment.status === 'PENDING_VERIFICATION' &&
            (role !== 'MANAGER' || payment.recordedByCurrentMember === false),
        allocate:
            permissions.includes('payment:allocate') &&
            permissions.includes('receivable:read') &&
            payment.status === 'VERIFIED' &&
            payment.unallocatedAmount !== '0.00',
        reverse: permissions.includes('payment:reverse') && payment.status !== 'REVERSED',
    };
}

export function normalizePaymentAmount(amount: string) {
    const match = /^(0|[1-9]\d{0,31})(?:\.(\d{1,2}))?$/.exec(amount.trim());
    if (!match) return null;
    const normalized = match[1] + '.' + (match[2] ?? '').padEnd(2, '0');
    return normalized === '0.00' ? null : normalized;
}

function cents(amount: string) {
    return BigInt(amount.replace('.', ''));
}

export function allocationError(
    allocations: { invoiceId: string; amount: string; outstanding: string }[],
    available: string,
) {
    if (!allocations.length) return 'Select at least one invoice.';
    if (new Set(allocations.map((row) => row.invoiceId.toLowerCase())).size !== allocations.length)
        return 'Select each invoice once.';
    let total = BigInt(0);
    for (const row of allocations) {
        const amount = normalizePaymentAmount(row.amount);
        if (!amount)
            return 'Enter a positive amount with up to two decimal places for each invoice.';
        if (cents(amount) > cents(row.outstanding))
            return 'An allocation exceeds the outstanding invoice balance.';
        total += cents(amount);
    }
    if (total > cents(available)) return 'Allocations exceed the verified funds available.';
    return null;
}
