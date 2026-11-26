import { describe, expect, it } from 'vitest';
import { invoiceQuerySchema, invoiceSchema } from './invoice.js';

const id = '00000000-0000-4000-8000-000000000001';
const maxGross = '99999999999999999890000000000000.00';
const maxLine = '999999999999999998900000000000.00';

const invoice = (grossAmount: string, lineAmount: string) => ({
    id,
    customerId: id,
    orderId: id,
    fulfilmentId: id,
    invoiceNumber: 'INV-00000001',
    currency: 'JMD',
    issuedAt: '2026-11-21T12:00:00.000Z',
    dueAt: '2026-11-21',
    customerBillingSnapshot: {
        code: 'C-1',
        name: 'Customer',
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
    },
    paymentTermsSnapshot: { saleType: 'CASH', creditTermDays: null },
    grossAmount,
    taxTreatmentStatus: 'APPROVED_POLICY_NOT_CALCULATED',
    taxPolicyReference: 'JM-POLICY',
    taxPolicyVersion: '2026-1',
    status: 'ISSUED',
    lines: [
        {
            id,
            sourceOrderLineId: id,
            sourceFulfilmentLineId: id,
            description: 'Produce',
            quantity: '1',
            unit: 'KG',
            unitPrice: '1.0000',
            lineAmount,
        },
    ],
    createdAt: '2026-11-21T12:00:00.000Z',
});

describe('invoice money wire precision', () => {
    it('accepts the DECIMAL(34,2) maximum gross and representable line amount', () => {
        expect(invoiceSchema.parse(invoice(maxGross, maxLine)).grossAmount).toBe(maxGross);
    });

    it('rejects gross values requiring more than 32 integer digits', () => {
        expect(() =>
            invoiceSchema.parse(invoice('199999999999999998900000000000000.00', maxLine)),
        ).toThrow();
    });
});

describe('invoice management query', () => {
    it('validates server-side search, calendar ranges and supported sorting', () => {
        expect(
            invoiceQuerySchema.parse({
                search: ' inv-1 ',
                issueFrom: '2026-01-01',
                issueTo: '2026-01-31',
                dueFrom: '2026-02-01',
                sortBy: 'dueAt',
                sortDirection: 'asc',
            }),
        ).toMatchObject({ search: 'inv-1', sortBy: 'dueAt', sortDirection: 'asc' });
        expect(
            invoiceQuerySchema.safeParse({ issueFrom: '2026-02-01', issueTo: '2026-01-01' })
                .success,
        ).toBe(false);
        expect(invoiceQuerySchema.safeParse({ sortBy: 'customerName' }).success).toBe(false);
    });
});
