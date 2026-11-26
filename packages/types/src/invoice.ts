export const INVOICE_TAX_STATUSES = ['PENDING_POLICY', 'APPROVED_POLICY_NOT_CALCULATED'] as const;
export type InvoiceTaxTreatmentStatus = (typeof INVOICE_TAX_STATUSES)[number];
export type InvoiceState = 'ISSUED';

export interface InvoiceLine {
    id: string;
    sourceOrderLineId: string;
    sourceFulfilmentLineId: string;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    lineAmount: string;
}

export interface Invoice {
    id: string;
    customerId: string;
    orderId: string;
    fulfilmentId: string;
    invoiceNumber: string;
    currency: 'JMD';
    issuedAt: string;
    dueAt: string;
    customerBillingSnapshot: {
        code: string;
        name: string;
        contactPerson: string | null;
        phone: string | null;
        email: string | null;
        address: string | null;
    };
    paymentTermsSnapshot: { saleType: 'CASH' | 'CREDIT'; creditTermDays: number | null };
    grossAmount: string;
    taxTreatmentStatus: InvoiceTaxTreatmentStatus;
    taxPolicyReference: string | null;
    taxPolicyVersion: string | null;
    status: InvoiceState;
    lines: InvoiceLine[];
    createdAt: string;
}

export interface InvoiceResponse {
    data: Invoice;
}
export interface InvoiceListResponse {
    data: Invoice[];
    meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
