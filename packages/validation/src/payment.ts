import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

const money = z.string().regex(/^(?:0|[1-9]\d{0,31})\.\d{2}$/);
const positiveMoney = money.refine((value) => value !== '0.00');
const resourceId = z.uuid();
export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER']);
const recordPaymentBase = z.object({ customerId: z.uuid(), amount: positiveMoney });
export const recordPaymentSchema = z.discriminatedUnion('method', [
    recordPaymentBase
        .extend({ method: z.literal('CASH'), cashReceiptNumber: z.string().trim().min(1).max(200) })
        .strict(),
    recordPaymentBase
        .extend({
            method: z.literal('BANK_TRANSFER'),
            receivingAccount: z.string().trim().min(1).max(200),
            bankTransferReference: z.string().trim().min(1).max(200),
        })
        .strict(),
]);
export const verifyPaymentSchema = z.object({}).strict();
export const allocatePaymentSchema = z
    .object({
        allocations: z
            .array(z.object({ invoiceId: z.uuid(), amount: positiveMoney }).strict())
            .min(1)
            .max(100),
    })
    .strict()
    .superRefine((value, context) => {
        const ids = value.allocations.map((allocation) => allocation.invoiceId.toLowerCase());
        if (new Set(ids).size !== ids.length) {
            context.addIssue({
                code: 'custom',
                message: 'Invoice IDs must be unique',
                path: ['allocations'],
            });
        }
    });
export const reversePaymentSchema = z
    .object({
        reason: z.string().trim().min(1).max(500),
    })
    .strict();
export const paymentQuerySchema = paginationQuerySchema
    .extend({ customerId: z.uuid().optional() })
    .strict();
const paymentEventSchema = z
    .object({
        id: resourceId,
        type: z.enum(['RECORDED', 'VERIFIED', 'REVERSED']),
        actorMembershipId: resourceId,
        reason: z.string().nullable(),
        selfVerification: z.boolean(),
        createdAt: z.iso.datetime(),
    })
    .strict();
const paymentAllocationResponseSchema = z
    .object({
        id: resourceId,
        invoiceId: resourceId,
        amount: money,
        activeAmount: money,
        allocatedByMembershipId: resourceId,
        createdAt: z.iso.datetime(),
        reversedAt: z.iso.datetime().nullable(),
    })
    .strict();
const paymentBaseSchema = z.object({
    id: resourceId,
    customerId: resourceId,
    amount: positiveMoney,
    currency: z.literal('JMD'),
    status: z.enum(['PENDING_VERIFICATION', 'VERIFIED', 'REVERSED']),
    recordedByMembershipId: resourceId,
    recordedAt: z.iso.datetime(),
    verifiedByMembershipId: resourceId.nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    selfVerification: z.boolean(),
    allocatedAmount: money,
    unallocatedAmount: money,
    events: z.array(paymentEventSchema),
    allocations: z.array(paymentAllocationResponseSchema),
});
export const paymentSchema = z.discriminatedUnion('method', [
    paymentBaseSchema
        .extend({
            method: z.literal('CASH'),
            cashReceiptNumber: z.string().min(1).max(200),
            receivingAccount: z.null(),
            bankTransferReference: z.null(),
        })
        .strict(),
    paymentBaseSchema
        .extend({
            method: z.literal('BANK_TRANSFER'),
            cashReceiptNumber: z.null(),
            receivingAccount: z.string().min(1).max(200),
            bankTransferReference: z.string().min(1).max(200),
        })
        .strict(),
]);
export const paymentResponseSchema = z.object({ data: paymentSchema }).strict();
export const paymentListResponseSchema = z
    .object({
        data: z.array(paymentSchema),
        meta: z
            .object({
                page: z.number().int(),
                pageSize: z.number().int(),
                totalItems: z.number().int(),
                totalPages: z.number().int(),
            })
            .strict(),
    })
    .strict();
export const invoicePaymentBalanceSchema = z
    .object({
        invoiceId: resourceId,
        currency: z.literal('JMD'),
        grossAmount: money,
        allocatedAmount: money,
        outstandingAmount: money,
    })
    .strict();
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type AllocatePaymentInput = z.infer<typeof allocatePaymentSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type PaymentQuery = z.infer<typeof paymentQuerySchema>;
