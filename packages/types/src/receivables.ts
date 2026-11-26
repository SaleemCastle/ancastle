export const RECEIVABLE_AGING_BUCKETS = [
    'CURRENT',
    '1_TO_30',
    '31_TO_60',
    '61_TO_90',
    'OVER_90',
] as const;

export type ReceivableAgingBucket = (typeof RECEIVABLE_AGING_BUCKETS)[number];
export type ReceivableInvoiceStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface ReceivableAging {
    current: string;
    days1To30: string;
    days31To60: string;
    days61To90: string;
    over90: string;
}

export interface ReceivableInvoice {
    invoiceId: string;
    invoiceNumber: string;
    customerId: string;
    customerName: string;
    currency: 'JMD';
    issuedAt: string;
    dueAt: string;
    grossAmount: string;
    allocatedAmount: string;
    outstandingAmount: string;
    status: ReceivableInvoiceStatus;
    overdue: boolean;
    daysOverdue: number;
    agingBucket: ReceivableAgingBucket;
}

export interface ReceivableCustomerSummary {
    customerId: string;
    customerCode: string;
    customerName: string;
    currency: 'JMD';
    invoiceCount: number;
    overdueInvoiceCount: number;
    totalOutstanding: string;
    unappliedCash: string;
    aging: ReceivableAging;
}

export interface ReceivableInvoiceListResponse {
    data: ReceivableInvoice[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
        asOfDate: string;
    };
}

export interface ReceivableSummary {
    currency: 'JMD';
    asOfDate: string;
    totalInvoiced: string;
    totalOutstanding: string;
    totalOverdue: string;
    totalSettled: string;
}

export interface ReceivableSummaryResponse {
    data: ReceivableSummary;
}

export interface ReceivableCustomerListResponse {
    data: ReceivableCustomerSummary[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
        asOfDate: string;
    };
}

export interface ReceivableCustomerResponse {
    data: ReceivableCustomerSummary & { asOfDate: string };
}

export type CustomerStatementEntryType = 'INVOICE' | 'PAYMENT_ALLOCATION' | 'ALLOCATION_REVERSAL';

export interface CustomerStatementEntry {
    id: string;
    type: CustomerStatementEntryType;
    invoiceId: string;
    invoiceNumber: string;
    businessDate: string;
    effectiveAt: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: string;
}

export interface CustomerStatementResponse {
    data: {
        organizationId: string;
        customerId: string;
        customerCode: string;
        customerName: string;
        currency: 'JMD';
        from: string;
        to: string;
        asOfAt: string;
        openingBalance: string;
        closingBalance: string;
        unappliedCash: string;
        entries: CustomerStatementEntry[];
        meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
}
