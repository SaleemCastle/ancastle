import { describe, expect, it } from 'vitest';
import type { Payment } from '@ancastle/types';
import { allocationError, normalizePaymentAmount, paymentActions } from './payments';
import { formatJmdAmount } from './finance';

const maximum = '99999999999999999999999999999999.99';
const payment = {
    status: 'PENDING_VERIFICATION',
    recordedByCurrentMember: true,
    unallocatedAmount: '50.00',
} as Payment;

describe('payment controls', () => {
    it('requires explicit authorization and applies manager self-verification rules', () => {
        expect(paymentActions(payment, [], 'OWNER').verify).toBe(false);
        expect(paymentActions(payment, ['payment:verify'], 'OWNER').verify).toBe(true);
        expect(paymentActions(payment, ['payment:verify'], 'ADMIN').verify).toBe(true);
        expect(paymentActions(payment, ['payment:verify'], 'MANAGER').verify).toBe(false);
        expect(
            paymentActions(
                { ...payment, recordedByCurrentMember: false },
                ['payment:verify'],
                'MANAGER',
            ).verify,
        ).toBe(true);
        expect(paymentActions(payment, ['payment:read', 'payment:record'], 'STAFF')).toEqual({
            verify: false,
            allocate: false,
            reverse: false,
        });
    });

    it('gates allocation and reversal by lifecycle and permission', () => {
        const permissions = ['payment:allocate', 'payment:reverse', 'receivable:read'];
        expect(paymentActions(payment, permissions, 'OWNER').allocate).toBe(false);
        expect(
            paymentActions({ ...payment, status: 'VERIFIED' }, permissions, 'OWNER').allocate,
        ).toBe(true);
        expect(
            paymentActions(
                { ...payment, status: 'VERIFIED', unallocatedAmount: '0.00' },
                permissions,
                'OWNER',
            ).allocate,
        ).toBe(false);
        expect(
            paymentActions({ ...payment, status: 'REVERSED' }, permissions, 'OWNER').reverse,
        ).toBe(false);
    });

    it('retains exact maximum values and validates payment and invoice ceilings by cents', () => {
        expect(normalizePaymentAmount(maximum)).toBe(maximum);
        expect(formatJmdAmount(maximum)).toBe('JMD 99,999,999,999,999,999,999,999,999,999,999.99');
        expect(normalizePaymentAmount('100000000000000000000000000000000.00')).toBeNull();
        expect(normalizePaymentAmount('1e2')).toBeNull();
        expect(normalizePaymentAmount(' 5.1 ')).toBe('5.10');
        const full = { invoiceId: 'a', amount: maximum, outstanding: maximum };
        const cent = { invoiceId: 'b', amount: '0.01', outstanding: '1.00' };
        expect(allocationError([full], maximum)).toBeNull();
        expect(allocationError([full, cent], maximum)).toMatch(/verified funds/);
        expect(allocationError([full, full], maximum)).toMatch(/each invoice once/);
        expect(allocationError([full, { ...cent, outstanding: '0.00' }], maximum)).toMatch(
            /outstanding invoice/,
        );
        expect(allocationError([cent], maximum)).toBeNull();
    });
});
