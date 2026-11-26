import { RECEIVABLE_AGING_BUCKETS } from '@ancastle/types';
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

const date = z.iso.date();
const id = z.uuid();
const bucket = z.enum(RECEIVABLE_AGING_BUCKETS);
const aggregateMoney = z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/);
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

export const receivableInvoiceQuerySchema = paginationQuerySchema
    .extend({
        customerId: id.optional(),
        invoiceId: id.optional(),
        search: z.string().trim().min(1).max(120).optional(),
        issueFrom: date.optional(),
        issueTo: date.optional(),
        dueFrom: date.optional(),
        dueTo: date.optional(),
        sortBy: z.enum(['issuedAt', 'dueAt', 'invoiceNumber']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
        overdue: queryBoolean.optional(),
        agingBucket: bucket.optional(),
        asOfDate: date.optional(),
    })
    .strict();

export const receivableCustomerQuerySchema = paginationQuerySchema
    .extend({ search: z.string().trim().min(1).max(120).optional(), asOfDate: date.optional() })
    .strict();

export const receivableAsOfQuerySchema = z.object({ asOfDate: date.optional() }).strict();

export const statementQuerySchema = paginationQuerySchema
    .extend({
        from: date,
        to: date,
        asOf: z.iso.datetime({ offset: true }).optional(),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.from > value.to) {
            context.addIssue({
                code: 'custom',
                message: 'from must be on or before to',
                path: ['from'],
            });
        }
    });

const money = aggregateMoney;
export const receivableSummarySchema = z
    .object({
        data: z
            .object({
                currency: z.literal('JMD'),
                asOfDate: date,
                totalInvoiced: money,
                totalOutstanding: money,
                totalOverdue: money,
                totalSettled: money,
            })
            .strict(),
    })
    .strict();
const agingSchema = z
    .object({
        current: money,
        days1To30: money,
        days31To60: money,
        days61To90: money,
        over90: money,
    })
    .strict();

export const receivableInvoiceSchema = z
    .object({
        invoiceId: id,
        invoiceNumber: z.string().min(1),
        customerId: id,
        customerName: z.string(),
        currency: z.literal('JMD'),
        issuedAt: z.iso.datetime(),
        dueAt: date,
        grossAmount: money,
        allocatedAmount: money,
        outstandingAmount: money,
        status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']),
        overdue: z.boolean(),
        daysOverdue: z.number().int().nonnegative(),
        agingBucket: bucket,
    })
    .strict();

export const receivableCustomerSummarySchema = z
    .object({
        customerId: id,
        customerCode: z.string(),
        customerName: z.string(),
        currency: z.literal('JMD'),
        invoiceCount: z.number().int().nonnegative(),
        overdueInvoiceCount: z.number().int().nonnegative(),
        totalOutstanding: money,
        unappliedCash: money,
        aging: agingSchema,
    })
    .strict();

const paginationMeta = z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
});

export const receivableInvoiceListResponseSchema = z
    .object({
        data: z.array(receivableInvoiceSchema),
        meta: paginationMeta.extend({ asOfDate: date }).strict(),
    })
    .strict();

export const receivableCustomerListResponseSchema = z
    .object({
        data: z.array(receivableCustomerSummarySchema),
        meta: paginationMeta.extend({ asOfDate: date }).strict(),
    })
    .strict();

export const receivableCustomerResponseSchema = z
    .object({
        data: receivableCustomerSummarySchema.extend({ asOfDate: date }).strict(),
    })
    .strict();

export const customerStatementEntrySchema = z
    .object({
        id,
        type: z.enum(['INVOICE', 'PAYMENT_ALLOCATION', 'ALLOCATION_REVERSAL']),
        invoiceId: id,
        invoiceNumber: z.string().min(1),
        businessDate: date,
        effectiveAt: z.iso.datetime(),
        direction: z.enum(['DEBIT', 'CREDIT']),
        amount: money,
    })
    .strict();

export const customerStatementResponseSchema = z
    .object({
        data: z
            .object({
                organizationId: id,
                customerId: id,
                customerCode: z.string(),
                customerName: z.string(),
                currency: z.literal('JMD'),
                from: date,
                to: date,
                asOfAt: z.iso.datetime(),
                openingBalance: money,
                closingBalance: money,
                unappliedCash: money,
                entries: z.array(customerStatementEntrySchema),
                meta: paginationMeta.strict(),
            })
            .strict(),
    })
    .strict();

export type ReceivableInvoiceQuery = z.infer<typeof receivableInvoiceQuerySchema>;
export type ReceivableCustomerQuery = z.infer<typeof receivableCustomerQuerySchema>;
export type StatementQuery = z.infer<typeof statementQuerySchema>;
