import { describe, expect, it } from 'vitest';
import {
    allocatePaymentSchema,
    paymentResponseSchema,
    recordPaymentSchema,
    reversePaymentSchema,
} from './payment.js';

const id = '8b286d46-5fce-4bce-ae2c-6c7c754e1cb1';

describe('payment contracts', () => {
    it('accepts a calendar transaction date and keeps older recording clients compatible', () => {
        const cash = { customerId: id, amount: '1.00', method: 'CASH', cashReceiptNumber: 'C-1' };
        expect(recordPaymentSchema.safeParse(cash).success).toBe(true);
        expect(
            recordPaymentSchema.safeParse({ ...cash, transactionDate: '2026-02-28' }).success,
        ).toBe(true);
        expect(
            recordPaymentSchema.safeParse({ ...cash, transactionDate: '2026-02-29' }).success,
        ).toBe(false);
        expect(
            recordPaymentSchema.safeParse({ ...cash, transactionDate: '2026-02-28T12:00:00Z' })
                .success,
        ).toBe(false);
    });
    it('accepts exact positive JMD amounts and method-specific evidence', () => {
        expect(
            recordPaymentSchema.safeParse({
                customerId: id,
                amount: '0.01',
                method: 'BANK_TRANSFER',
                receivingAccount: 'acct-1',
                bankTransferReference: '  bank-ref-1  ',
            }).success,
        ).toBe(true);
        expect(
            recordPaymentSchema.safeParse({
                customerId: id,
                amount: '99999999999999999999999999999999.99',
                method: 'CASH',
                cashReceiptNumber: 'max-amount',
            }).success,
        ).toBe(true);
        expect(
            recordPaymentSchema.safeParse({
                customerId: id,
                amount: '100000000000000000000000000000000.00',
                method: 'CASH',
                cashReceiptNumber: 'overflow-amount',
            }).success,
        ).toBe(false);
        expect(
            recordPaymentSchema.safeParse({
                customerId: id,
                amount: '0.00',
                method: 'CASH',
                cashReceiptNumber: 'cash-1',
            }).success,
        ).toBe(false);
        expect(
            recordPaymentSchema.safeParse({
                customerId: id,
                amount: '1.00',
                method: 'CASH',
                cashReceiptNumber: ' ',
            }).success,
        ).toBe(false);
    });

    it('rejects duplicate invoice allocation targets and malformed money', () => {
        expect(
            allocatePaymentSchema.safeParse({
                allocations: [
                    { invoiceId: id, amount: '1.00' },
                    { invoiceId: id.toUpperCase(), amount: '1.00' },
                ],
            }).success,
        ).toBe(false);
        expect(
            allocatePaymentSchema.safeParse({ allocations: [{ invoiceId: id, amount: '1.001' }] })
                .success,
        ).toBe(false);
    });

    it('requires a reversal reason and validates the payment response boundary', () => {
        expect(reversePaymentSchema.safeParse({ reason: '  ' }).success).toBe(false);
        expect(
            paymentResponseSchema.safeParse({
                data: {
                    id,
                    customerId: id,
                    amount: '12.00',
                    currency: 'JMD',
                    method: 'CASH',
                    cashReceiptNumber: 'receipt-1',
                    receivingAccount: null,
                    bankTransferReference: null,
                    status: 'PENDING_VERIFICATION',
                    recordedByMembershipId: id,
                    recordedAt: '2026-11-22T10:00:00.000Z',
                    verifiedByMembershipId: null,
                    verifiedAt: null,
                    selfVerification: false,
                    allocatedAmount: '0.00',
                    unallocatedAmount: '12.00',
                    events: [],
                    allocations: [],
                },
            }).success,
        ).toBe(true);
    });
});
