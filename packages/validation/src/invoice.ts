import { INVOICE_TAX_STATUSES, INVENTORY_UNITS } from '@ancastle/types';
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

export const issueInvoiceSchema = z.object({}).strict();
export const invoiceQuerySchema = paginationQuerySchema
    .extend({
        customerId: z.uuid().optional(),
        search: z.string().trim().min(1).max(120).optional(),
        issueFrom: z.iso.date().optional(),
        issueTo: z.iso.date().optional(),
        dueFrom: z.iso.date().optional(),
        dueTo: z.iso.date().optional(),
        sortBy: z.enum(['issuedAt', 'dueAt', 'invoiceNumber', 'grossAmount']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.issueFrom && value.issueTo && value.issueFrom > value.issueTo)
            ctx.addIssue({
                code: 'custom',
                path: ['issueFrom'],
                message: 'Issue date range is invalid',
            });
        if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo)
            ctx.addIssue({
                code: 'custom',
                path: ['dueFrom'],
                message: 'Due date range is invalid',
            });
    })
    .strict();

// DECIMAL(34,2): 32 integer digits plus exact JMD cents.
const money = z.string().regex(/^(?:0|[1-9]\d{0,31})\.\d{2}$/);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/);
export const invoiceLineSchema = z
    .object({
        id: z.uuid(),
        sourceOrderLineId: z.uuid(),
        sourceFulfilmentLineId: z.uuid(),
        description: z.string(),
        quantity,
        unit: z.enum(INVENTORY_UNITS),
        unitPrice: z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/),
        lineAmount: money,
    })
    .strict();
export const invoiceSchema = z
    .object({
        id: z.uuid(),
        customerId: z.uuid(),
        orderId: z.uuid(),
        fulfilmentId: z.uuid(),
        invoiceNumber: z.string().min(1),
        currency: z.literal('JMD'),
        issuedAt: z.iso.datetime(),
        dueAt: z.iso.date(),
        customerBillingSnapshot: z
            .object({
                code: z.string(),
                name: z.string(),
                contactPerson: z.string().nullable(),
                phone: z.string().nullable(),
                email: z.string().nullable(),
                address: z.string().nullable(),
            })
            .strict(),
        paymentTermsSnapshot: z
            .object({
                saleType: z.enum(['CASH', 'CREDIT']),
                creditTermDays: z.number().int().nonnegative().nullable(),
            })
            .strict(),
        grossAmount: money,
        taxTreatmentStatus: z.enum(INVOICE_TAX_STATUSES),
        taxPolicyReference: z.string().min(1).nullable(),
        taxPolicyVersion: z.string().min(1).nullable(),
        status: z.literal('ISSUED'),
        lines: z.array(invoiceLineSchema),
        createdAt: z.iso.datetime(),
    })
    .strict();
export const invoiceResponseSchema = z.object({ data: invoiceSchema }).strict();
export const invoiceListResponseSchema = z
    .object({
        data: z.array(invoiceSchema),
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
export const invoiceCustomersResponseSchema = z
    .object({
        data: z
            .array(z.object({ customerId: z.uuid(), customerName: z.string() }).strict())
            .max(500),
    })
    .strict();
export const eligibleInvoiceFulfilmentsResponseSchema = z
    .object({
        data: z
            .array(
                z
                    .object({
                        id: z.uuid(),
                        code: z.string(),
                        orderId: z.uuid(),
                        customerName: z.string(),
                        occurredAt: z.iso.datetime(),
                        grossAmount: money,
                    })
                    .strict(),
            )
            .max(100),
    })
    .strict();
export const invoiceIssuanceStatusResponseSchema = z
    .object({
        data: z.object({ enabled: z.boolean(), message: z.string().nullable() }).strict(),
    })
    .strict();
export const invoiceHistoryResponseSchema = z
    .object({
        data: z.array(
            z
                .object({
                    id: z.uuid(),
                    type: z.string(),
                    actorMembershipId: z.uuid(),
                    details: z.unknown(),
                    createdAt: z.iso.datetime(),
                })
                .strict(),
        ),
    })
    .strict();
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;
