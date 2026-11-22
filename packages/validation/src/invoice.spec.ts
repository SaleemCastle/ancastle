import { describe, expect, it } from 'vitest';
import { invoiceSchema } from './invoice.js';

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
