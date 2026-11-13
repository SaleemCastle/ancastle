import { z } from 'zod';
import {
    INVENTORY_UNITS,
    SALES_PRODUCT_KINDS,
    ORDER_STATES,
    FULFILMENT_PROGRESS_STATES,
    FULFILMENT_KINDS,
    SALES_CURRENCY,
    type SalesProduct,
    type PoultryProductSource,
    type CommercialTerms,
    type OrderLine,
    type Order,
    type OrderDetail,
    type Fulfilment,
    type FlockSaleDepletion,
    type FulfilmentCommandReceipt,
    type InventoryUnit,
} from '@ancastle/types';
import { resourceIdSchema } from './organization-farm.js';
import {
    paginationQuerySchema,
    activeStatusQuerySchema,
    paginationMetaSchema,
} from './pagination.js';

const id = resourceIdSchema;
const name = z.string().trim().min(1).max(120);
const instant = z.iso.datetime({ offset: true });
const occurredAt = instant.transform((value) => new Date(value).toISOString());
const version = z.number().int().min(1).max(2_147_483_647);
const unit = z.enum(INVENTORY_UNITS);
const reason = z.string().trim().min(1).max(2000);
const note = z.string().trim().max(2000);
const reference = z.string().trim().max(120);

function decimalString(integerDigits: number, scale: number, positive: boolean, fixed = false) {
    return z
        .string()
        .max(integerDigits + scale + 1)
        .regex(new RegExp(`^(?:0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.\\d{1,${scale}})?$`))
        .refine((value) => !positive || /[1-9]/.test(value), 'Quantity must be positive')
        .transform((value) => {
            const [whole, fraction = ''] = value.split('.');
            const digits = fixed ? fraction.padEnd(scale, '0') : fraction.replace(/0+$/, '');
            return digits ? `${whole}.${digits}` : whole;
        });
}

/** Exact wire values only: no coercion of a possibly rounded JSON number. */
// Produce quantities match M3 Decimal(18,3); EACH integrality is checked with its unit.
export const salesQuantitySchema = decimalString(15, 3, true);
export const salesQuantityTotalSchema = decimalString(15, 3, false);
/** JMD Decimal(19,4): at most 15 integer and four fractional digits, without rounding. */
export const salesUnitPriceSchema = decimalString(15, 4, false, true);
/** Read-only server amount, already rounded half-up per line, always two fractional digits. */
export const orderAmountSchema = z
    .string()
    .max(39)
    .regex(/^(?:0|[1-9]\d{0,35})\.\d{2}$/);
export const salesCurrencySchema = z.literal(SALES_CURRENCY);
export const salesProductKindSchema = z.enum(SALES_PRODUCT_KINDS);
export const orderStateSchema = z.enum(ORDER_STATES);
export const fulfilmentProgressSchema = z.enum(FULFILMENT_PROGRESS_STATES);
export const fulfilmentKindSchema = z.enum(FULFILMENT_KINDS);
export const birdCountSchema = z.number().int().min(1).max(2_147_483_647);
export const poultrySalesQuantitySchema = salesQuantitySchema.refine(
    // At most ten integer digits are exactly representable, including the Int32 limit.
    (value) => value.length <= 10 && /^\d+$/.test(value) && Number(value) <= 2_147_483_647,
    'Poultry quantity must be whole birds within the starting-population range',
);

export const commercialTermsSchema = z.discriminatedUnion('saleType', [
    z.object({ saleType: z.literal('CASH'), creditTermDays: z.null() }).strict(),
    z.object({ saleType: z.literal('CREDIT'), creditTermDays: version }).strict(),
]) satisfies z.ZodType<CommercialTerms>;
// The period is due-date intent, not an invoice due date or evidence of payment.

const productDefinitionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('POULTRY') }).strict(),
    z
        .object({ kind: z.literal('PRODUCE'), inventoryItemId: id, expectedInventoryUnit: unit })
        .strict(),
]);
export const createSalesProductSchema = z.discriminatedUnion('kind', [
    productDefinitionSchema.options[0].extend({ name }).strict(),
    productDefinitionSchema.options[1].extend({ name }).strict(),
]);
/** Source definition changes are atomic; the future service checks confirmed references. */
export const updateSalesProductSchema = z
    .object({ name: name.optional(), definition: productDefinitionSchema.optional() })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export const salesProductLifecycleSchema = z.object({}).strict();
export const createPoultryProductSourceSchema = z.object({ flockId: id }).strict();
export const poultryProductSourceLifecycleSchema = salesProductLifecycleSchema;
export const salesProductQuerySchema = paginationQuerySchema
    .extend({
        search: z.string().trim().max(120).optional(),
        kind: salesProductKindSchema.optional(),
        isActive: activeStatusQuerySchema.optional(),
    })
    .strict();
export const poultryProductSourceQuerySchema = paginationQuerySchema
    .extend({ isActive: activeStatusQuerySchema.optional() })
    .strict();

const productFields = {
    id,
    code: name,
    name,
    isActive: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
};
export const salesProductSchema = z.discriminatedUnion('kind', [
    z.object({ ...productFields, kind: z.literal('POULTRY'), unit: z.literal('EACH') }).strict(),
    z.object({ ...productFields, kind: z.literal('PRODUCE'), unit, inventoryItemId: id }).strict(),
]) satisfies z.ZodType<SalesProduct>;
export const poultryProductSourceSchema = z
    .object({
        id,
        productId: id,
        farmId: id,
        flockId: id,
        flockCode: name,
        flockName: name,
        flockIsActive: z.boolean(),
        productIsActive: z.boolean(),
        isActive: z.boolean(),
        isEligible: z.boolean(),
        actorUserId: id,
        createdAt: instant,
        updatedAt: instant,
    })
    .strict() satisfies z.ZodType<PoultryProductSource>;

/** A catalog identity precondition, not a physical allocation or tenant authority. */
export const expectedSalesProductSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('POULTRY'), unit: z.literal('EACH') }).strict(),
    z.object({ kind: z.literal('PRODUCE'), unit, inventoryItemId: id }).strict(),
]);
function checkUnitQuantity(
    kind: string,
    selectedUnit: InventoryUnit,
    quantity: string,
    ctx: z.RefinementCtx,
    field: string,
) {
    const schema = kind === 'POULTRY' ? poultrySalesQuantitySchema : salesQuantitySchema;
    if (
        !schema.safeParse(quantity).success ||
        (selectedUnit === 'EACH' && quantity.includes('.'))
    ) {
        ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'Invalid quantity for the selected kind/unit',
        });
    }
}
export const orderLineInputSchema = z
    .object({
        productId: id,
        expectedProduct: expectedSalesProductSchema,
        quantity: salesQuantitySchema,
        unitPrice: salesUnitPriceSchema,
    })
    .strict()
    .superRefine((value, ctx) =>
        checkUnitQuantity(
            value.expectedProduct.kind,
            value.expectedProduct.unit,
            value.quantity,
            ctx,
            'quantity',
        ),
    );
export const createOrderSchema = z
    .object({
        customerId: id,
        currency: salesCurrencySchema,
        terms: commercialTermsSchema,
        lines: z.array(orderLineInputSchema).min(1).max(100),
    })
    .strict();
export const orderLineAmendmentSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('ADD'), line: orderLineInputSchema }).strict(),
    z.object({ operation: z.literal('UPDATE'), lineId: id, line: orderLineInputSchema }).strict(),
    z.object({ operation: z.literal('REMOVE'), lineId: id }).strict(),
]);
export const amendOrderSchema = z
    .object({
        expectedOrderVersion: version,
        customerId: id.optional(),
        currency: salesCurrencySchema.optional(),
        terms: commercialTermsSchema.optional(),
        lines: z.array(orderLineAmendmentSchema).min(1).max(100).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (Object.keys(value).every((key) => key === 'expectedOrderVersion'))
            ctx.addIssue({ code: 'custom', message: 'Provide a draft amendment' });
        const lineIds =
            value.lines?.flatMap((line) => ('lineId' in line ? [line.lineId] : [])) ?? [];
        if (new Set(lineIds).size !== lineIds.length)
            ctx.addIssue({
                code: 'custom',
                path: ['lines'],
                message: 'Amend each existing line at most once',
            });
    });
// Draft state, immutable confirmed snapshots, customer/source ownership and merged values
// must be revalidated against persisted data by the eventual service, not body claims.
export const confirmOrderSchema = z.object({ expectedOrderVersion: version }).strict();
export const cancelOrderSchema = z.object({ expectedOrderVersion: version, reason }).strict();
export const orderQuerySchema = paginationQuerySchema
    .extend({
        customerId: id.optional(),
        state: orderStateSchema.optional(),
        progress: fulfilmentProgressSchema.optional(),
        search: z.string().trim().max(120).optional(),
    })
    .strict();

export const fulfilmentAllocationInputSchema = z.discriminatedUnion('kind', [
    z
        .object({
            orderLineId: id,
            kind: z.literal('POULTRY'),
            flockId: id,
            quantity: poultrySalesQuantitySchema,
        })
        .strict(),
    z
        .object({
            orderLineId: id,
            kind: z.literal('PRODUCE'),
            inventoryItemId: id,
            quantity: salesQuantitySchema,
        })
        .strict(),
]);
export const postFulfilmentSchema = z
    .object({
        expectedOrderVersion: version,
        occurredAt,
        note: note.optional(),
        reference: reference.optional(),
        allocations: z.array(fulfilmentAllocationInputSchema).min(1).max(100),
    })
    .strict()
    .superRefine((value, ctx) => {
        const keys = value.allocations.map(
            (line) =>
                `${line.orderLineId}:${line.kind}:${line.kind === 'POULTRY' ? line.flockId : line.inventoryItemId}`,
        );
        if (new Set(keys).size !== keys.length)
            ctx.addIssue({
                code: 'custom',
                path: ['allocations'],
                message: 'Duplicate line/source allocation',
            });
    });
// Produce EACH integrality/remaining quantity comes from the locked order line;
// fulfilment bodies deliberately cannot supply an authoritative unit or balance.
export const reverseFulfilmentSchema = z
    .object({
        expectedOrderVersion: version,
        occurredAt,
        reason,
        postingErrorConfirmed: z.literal(true),
        reference: reference.optional(),
    })
    .strict();
export const idempotencyKeySchema = z.uuid();
/** Validate the picked, normalized header only, not the entire raw HTTP header bag. */
export const fulfilmentRequestHeadersSchema = z
    .object({ 'idempotency-key': idempotencyKeySchema })
    .strict();
export const fulfilmentQuerySchema = paginationQuerySchema
    .extend({ orderId: id.optional(), kind: fulfilmentKindSchema.optional() })
    .strict();

const customerReferenceSchema = z.object({ id, code: name, name }).strict();
export const customerSnapshotSchema = customerReferenceSchema
    .extend({
        contactPerson: z.string().max(120).nullable(),
        phone: z.string().max(30).nullable(),
        email: z.string().max(254).nullable(),
        address: z.string().max(500).nullable(),
    })
    .strict();
const commercialLineFields = {
    id,
    lineNumber: z.number().int().min(1),
    productId: id,
    productCode: name,
    productName: name,
    orderedQuantity: salesQuantitySchema,
    unitPrice: salesUnitPriceSchema,
    lineAmount: orderAmountSchema,
    fulfilledQuantity: salesQuantityTotalSchema,
    remainingQuantity: salesQuantityTotalSchema,
    cancelledQuantity: salesQuantityTotalSchema,
    fulfilmentProgress: fulfilmentProgressSchema.nullable(),
    isRemoved: z.boolean(),
};
export const orderLineSchema = z
    .discriminatedUnion('kind', [
        z
            .object({
                ...commercialLineFields,
                kind: z.literal('POULTRY'),
                unit: z.literal('EACH'),
            })
            .strict(),
        z.object({ ...commercialLineFields, kind: z.literal('PRODUCE'), unit }).strict(),
    ])
    .superRefine((value, ctx) => {
        checkUnitQuantity(value.kind, value.unit, value.orderedQuantity, ctx, 'orderedQuantity');
        if (value.unit === 'EACH') {
            for (const field of [
                'fulfilledQuantity',
                'remainingQuantity',
                'cancelledQuantity',
            ] as const)
                if (value[field].includes('.'))
                    ctx.addIssue({
                        code: 'custom',
                        path: [field],
                        message: 'EACH requires whole units',
                    });
        }
    }) satisfies z.ZodType<OrderLine>;
const summaryFields = {
    id,
    code: name,
    customer: customerReferenceSchema,
    commercialState: orderStateSchema,
    fulfilmentProgress: fulfilmentProgressSchema.nullable(),
    version,
    currency: salesCurrencySchema,
    terms: commercialTermsSchema,
    totalAmount: orderAmountSchema,
    createdAt: instant,
    updatedAt: instant,
};
export const orderSummarySchema = z.object(summaryFields).strict();
const orderFields = {
    ...summaryFields,
    customer: customerSnapshotSchema,
    lines: z.array(orderLineSchema).max(100),
};
export const orderSchema = z.object(orderFields).strict() satisfies z.ZodType<Order>;

const allocationFields = { id, orderLineId: id, quantity: salesQuantitySchema, sourceCode: name };
const poultryFields = {
    kind: z.literal('POULTRY'),
    unit: z.literal('EACH'),
    flockId: id,
    depletionId: id,
    quantity: poultrySalesQuantitySchema,
};
const produceFields = {
    kind: z.literal('PRODUCE'),
    unit,
    inventoryItemId: id,
    inventoryMovementId: id,
};
export const fulfilmentPostingLineSchema = z
    .discriminatedUnion('kind', [
        z.object({ ...allocationFields, ...poultryFields, reversesLineId: z.null() }).strict(),
        z
            .object({
                ...allocationFields,
                ...produceFields,
                reversesLineId: z.null(),
                movementReason: z.literal('ISSUE'),
            })
            .strict(),
    ])
    .superRefine((value, ctx) =>
        checkUnitQuantity(value.kind, value.unit, value.quantity, ctx, 'quantity'),
    );
export const fulfilmentReversalLineSchema = z
    .discriminatedUnion('kind', [
        z.object({ ...allocationFields, ...poultryFields, reversesLineId: id }).strict(),
        z
            .object({
                ...allocationFields,
                ...produceFields,
                reversesLineId: id,
                movementReason: z.literal('ADJUSTMENT'),
            })
            .strict(),
    ])
    .superRefine((value, ctx) =>
        checkUnitQuantity(value.kind, value.unit, value.quantity, ctx, 'quantity'),
    );
const fulfilmentFields = {
    id,
    code: name,
    orderId: id,
    farmId: id,
    actorUserId: id,
    occurredAt: instant,
    createdAt: instant,
    note: note.nullable(),
    reference: reference.nullable(),
};
export const fulfilmentSchema = z.discriminatedUnion('kind', [
    z
        .object({
            ...fulfilmentFields,
            kind: z.literal('POSTING'),
            reversesFulfilmentId: z.null(),
            lines: z.array(fulfilmentPostingLineSchema).min(1).max(100),
        })
        .strict(),
    z
        .object({
            ...fulfilmentFields,
            kind: z.literal('REVERSAL'),
            reversesFulfilmentId: id,
            reason,
            postingErrorConfirmed: z.literal(true),
            lines: z.array(fulfilmentReversalLineSchema).min(1).max(100),
        })
        .strict(),
]) satisfies z.ZodType<Fulfilment>;
export const flockSaleDepletionSchema = z
    .object({
        id,
        farmId: id,
        flockId: id,
        fulfilmentLineId: id,
        birdCount: birdCountSchema,
        reversesDepletionId: id.nullable(),
        actorUserId: id,
        occurredAt: instant,
        createdAt: instant,
    })
    .strict() satisfies z.ZodType<FlockSaleDepletion>;

const collection = <T extends z.ZodType>(schema: T) =>
    z.object({ data: z.array(schema).max(100), meta: paginationMetaSchema }).strict();
const resource = <T extends z.ZodType>(schema: T) => z.object({ data: schema }).strict();
export const salesProductResponseSchema = resource(salesProductSchema);
export const salesProductListResponseSchema = collection(salesProductSchema);
export const poultryProductSourceResponseSchema = resource(poultryProductSourceSchema);
export const poultryProductSourceListResponseSchema = collection(poultryProductSourceSchema);
export const orderResponseSchema = resource(orderSchema);
export const orderListResponseSchema = collection(orderSummarySchema);
export const fulfilmentResponseSchema = resource(fulfilmentSchema);
export const fulfilmentListResponseSchema = collection(fulfilmentSchema);
export const flockSaleDepletionResponseSchema = resource(flockSaleDepletionSchema);

export const redactedOrderSourcesSchema = z.object({ visibility: z.literal('REDACTED') }).strict();
/** Shape validation is not authorization; a service must verify this farm before selecting it. */
export const authorizedOrderSourcesSchema = z
    .object({
        visibility: z.literal('AUTHORIZED'),
        farmId: id,
        history: fulfilmentListResponseSchema,
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.history.data.some((event) => event.farmId !== value.farmId))
            ctx.addIssue({
                code: 'custom',
                path: ['history'],
                message: 'History must be limited to the authorized farm',
            });
    });
export const redactedOrderDetailSchema = z
    .object({ ...orderFields, sourceDetails: redactedOrderSourcesSchema })
    .strict();
export const authorizedOrderDetailSchema = z
    .object({ ...orderFields, sourceDetails: authorizedOrderSourcesSchema })
    .strict()
    .superRefine((value, ctx) => {
        if (value.sourceDetails.history.data.some((event) => event.orderId !== value.id))
            ctx.addIssue({
                code: 'custom',
                path: ['sourceDetails'],
                message: 'History must belong to this order',
            });
    });
export const orderDetailSchema = z.union([
    redactedOrderDetailSchema,
    authorizedOrderDetailSchema,
]) satisfies z.ZodType<OrderDetail>;
export const orderDetailResponseSchema = resource(orderDetailSchema);
export const fulfilmentCommandReceiptSchema = z
    .object({
        operation: z.enum(['POST', 'REVERSE']),
        idempotencyKey: idempotencyKeySchema,
        orderVersion: version,
        fulfilment: fulfilmentSchema,
    })
    .strict()
    .refine(
        (value) => value.operation === (value.fulfilment.kind === 'POSTING' ? 'POST' : 'REVERSE'),
        'Receipt operation must match its immutable event',
    ) satisfies z.ZodType<FulfilmentCommandReceipt>;
export const fulfilmentCommandResponseSchema = resource(fulfilmentCommandReceiptSchema);

export type CreateSalesProductInput = z.infer<typeof createSalesProductSchema>;
export type UpdateSalesProductInput = z.infer<typeof updateSalesProductSchema>;
export type CreatePoultryProductSourceInput = z.infer<typeof createPoultryProductSourceSchema>;
export type SalesProductQuery = z.infer<typeof salesProductQuerySchema>;
export type PoultryProductSourceQuery = z.infer<typeof poultryProductSourceQuerySchema>;
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type AmendOrderInput = z.infer<typeof amendOrderSchema>;
export type ConfirmOrderInput = z.infer<typeof confirmOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
export type FulfilmentAllocationInput = z.infer<typeof fulfilmentAllocationInputSchema>;
export type PostFulfilmentInput = z.infer<typeof postFulfilmentSchema>;
export type ReverseFulfilmentInput = z.infer<typeof reverseFulfilmentSchema>;
export type FulfilmentRequestHeaders = z.infer<typeof fulfilmentRequestHeadersSchema>;
export type FulfilmentQuery = z.infer<typeof fulfilmentQuerySchema>;
