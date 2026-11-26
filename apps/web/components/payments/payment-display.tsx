import type { Payment } from '@ancastle/types';
import { formatJamaicaDate, formatJamaicaInstant } from '@/lib/management/finance';
import { paymentStatusLabels } from '@/lib/management/payments';

const statusStyles = {
    PENDING_VERIFICATION: 'bg-amber-100 text-amber-900',
    VERIFIED: 'bg-emerald-100 text-emerald-900',
    REVERSED: 'bg-muted text-foreground',
};

export function PaymentStatusBadge({ status }: { status: Payment['status'] }) {
    return (
        <span
            className={
                'inline-block rounded-full px-2 py-1 text-xs font-medium ' + statusStyles[status]
            }
        >
            {paymentStatusLabels[status]}
        </span>
    );
}

export function PaymentDate({ payment }: { payment: Payment }) {
    if (!payment.transactionDate) {
        return <span>Recorded {formatJamaicaInstant(payment.recordedAt)}</span>;
    }
    return (
        <time dateTime={payment.transactionDate}>{formatJamaicaDate(payment.transactionDate)}</time>
    );
}
