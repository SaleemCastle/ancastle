export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
export type PaymentStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REVERSED';
export type PaymentLifecycleType = 'RECORDED' | 'VERIFIED' | 'REVERSED';

export interface PaymentLifecycleEvent {
    id: string;
    type: PaymentLifecycleType;
    actorMembershipId: string;
    reason: string | null;
    selfVerification: boolean;
    createdAt: string;
}

export interface PaymentAllocation {
    id: string;
    invoiceId: string;
    amount: string;
    activeAmount: string;
    allocatedByMembershipId: string;
    createdAt: string;
    reversedAt: string | null;
}

interface PaymentBase {
    id: string;
    customerId: string;
    amount: string;
    currency: 'JMD';
    method: PaymentMethod;
    status: PaymentStatus;
    recordedByMembershipId: string;
    recordedAt: string;
    verifiedByMembershipId: string | null;
    verifiedAt: string | null;
    selfVerification: boolean;
    allocatedAmount: string;
    unallocatedAmount: string;
    events: PaymentLifecycleEvent[];
    allocations: PaymentAllocation[];
}

export type Payment = PaymentBase &
    (
        | {
              method: 'CASH';
              cashReceiptNumber: string;
              receivingAccount: null;
              bankTransferReference: null;
          }
        | {
              method: 'BANK_TRANSFER';
              cashReceiptNumber: null;
              receivingAccount: string;
              bankTransferReference: string;
          }
    );

export interface PaymentResponse {
    data: Payment;
}

export interface PaymentListResponse {
    data: Payment[];
    meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface InvoicePaymentBalance {
    invoiceId: string;
    currency: 'JMD';
    grossAmount: string;
    allocatedAmount: string;
    outstandingAmount: string;
}

export interface InvoicePaymentAllocation {
    allocationId: string;
    paymentId: string;
    amount: string;
    activeAmount: string;
    paymentMethod: PaymentMethod;
    paymentRecordedAt: string;
    allocatedAt: string;
    reversedAt: string | null;
}
