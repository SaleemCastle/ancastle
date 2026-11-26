import { describe, expect, it } from 'vitest';
import {
    receivableInvoiceQuerySchema,
    receivableCustomerQuerySchema,
    statementQuerySchema,
    receivableInvoiceListResponseSchema,
    customerStatementResponseSchema,
} from './receivables.js';

const uuid1 = '00000000-0000-4000-8000-000000000001';
const uuid2 = '00000000-0000-4000-8000-000000000002';
const uuid3 = '00000000-0000-4000-8000-000000000003';

describe('receivables contracts', () => {
    it('validates supported receivables filters and rejects unrecognized fields', () => {
        expect(
            receivableInvoiceQuerySchema.parse({
                page: '2',
                pageSize: '50',
                status: 'PARTIALLY_PAID',
                overdue: 'true',
                agingBucket: '31_TO_60',
                asOfDate: '2026-11-23',
                customerId: uuid1,
                search: 'invoice',
                issueFrom: '2026-11-01',
                dueTo: '2026-11-30',
                sortBy: 'dueAt',
                sortDirection: 'asc',
            }),
        ).toMatchObject({ page: 2, pageSize: 50, overdue: true, agingBucket: '31_TO_60' });
        expect(receivableInvoiceQuerySchema.safeParse({ organizationId: uuid1 }).success).toBe(
            false,
        );
        expect(receivableCustomerQuerySchema.safeParse({ search: '  ' }).success).toBe(false);
    });

    it('requires ordered inclusive Jamaica calendar statement dates and an offset-aware cutoff', () => {
        expect(
            statementQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success,
        ).toBe(true);
        expect(
            statementQuerySchema.safeParse({ from: '2026-12-01', to: '2026-11-30' }).success,
        ).toBe(false);
        expect(
            statementQuerySchema.safeParse({
                from: '2026-11-01',
                to: '2026-11-30',
                asOf: '2026-11-30T23:00:00',
            }).success,
        ).toBe(false);
    });

    it('serializes high precision totals as decimal strings and validates response envelopes', () => {
        const invoiceId = uuid1;
        const customerId = uuid2;
        expect(
            receivableInvoiceListResponseSchema.parse({
                data: [
                    {
                        invoiceId,
                        invoiceNumber: 'INV-00000001',
                        customerId,
                        customerName: 'Customer',
                        currency: 'JMD',
                        issuedAt: '2026-11-01T12:00:00.000Z',
                        dueAt: '2026-11-01',
                        grossAmount: '99999999999999999890000000000000.00',
                        allocatedAmount: '0.00',
                        outstandingAmount: '99999999999999999890000000000000.00',
                        status: 'UNPAID',
                        overdue: true,
                        daysOverdue: 1,
                        agingBucket: '1_TO_30',
                    },
                ],
                meta: {
                    page: 1,
                    pageSize: 20,
                    totalItems: 1,
                    totalPages: 1,
                    asOfDate: '2026-11-02',
                },
            }).data,
        ).toHaveLength(1);
        expect(
            customerStatementResponseSchema.safeParse({
                data: {
                    organizationId: uuid3,
                    customerId,
                    customerCode: 'C1',
                    customerName: 'Customer',
                    currency: 'JMD',
                    from: '2026-11-01',
                    to: '2026-11-30',
                    asOfAt: '2026-12-01T04:59:59.999Z',
                    openingBalance: '0.00',
                    closingBalance: '0.00',
                    unappliedCash: '0.00',
                    entries: [],
                    meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
                },
            }).success,
        ).toBe(true);
        expect(receivableInvoiceQuerySchema.safeParse({ amount: 1 }).success).toBe(false);
    });
});
