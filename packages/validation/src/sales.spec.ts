import { describe, expect, it } from 'vitest';
import {
    createSalesProductSchema,
    updateSalesProductSchema,
    createPoultryProductSourceSchema,
    createOrderSchema,
    amendOrderSchema,
    orderLineInputSchema,
    commercialTermsSchema,
    salesQuantitySchema,
    salesUnitPriceSchema,
    orderAmountSchema,
    postFulfilmentSchema,
    reverseFulfilmentSchema,
    fulfilmentRequestHeadersSchema,
    salesProductQuerySchema,
    orderQuerySchema,
    fulfilmentQuerySchema,
    orderSchema,
    orderDetailResponseSchema,
    fulfilmentSchema,
    fulfilmentCommandReceiptSchema,
    flockSaleDepletionSchema,
    createInventoryMovementSchema,
    createInventoryMovementV2Schema,
    postFeedUsageSchema,
    postFeedUsageV2Schema,
    flockMetricsV2Schema,
} from './index.js';
import type { Order, Fulfilment, FlockMetrics } from '@ancastle/types';

const ids = Array.from(
    { length: 12 },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const [
    customerId,
    productId,
    itemId,
    flockId,
    orderId,
    lineId,
    farmId,
    eventId,
    movementId,
    actorId,
    otherId,
    key,
] = ids;
const at = '2026-11-13T12:00:00.000Z';
const cash = { saleType: 'CASH', creditTermDays: null } as const;
const poultryLine = {
    productId,
    expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
    quantity: '10',
    unitPrice: '123.45',
};
const produceLine = {
    productId,
    expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId: itemId },
    quantity: '1.125',
    unitPrice: '900.0001',
};
const draft = { customerId, currency: 'JMD', terms: cash, lines: [poultryLine, produceLine] };
const allocation = { orderLineId: lineId, kind: 'POULTRY', flockId, quantity: '3' };
const posting = { expectedOrderVersion: 1, occurredAt: at, allocations: [allocation] };
const correction = {
    expectedOrderVersion: 2,
    occurredAt: at,
    reason: 'Duplicate posting; no second handover',
    postingErrorConfirmed: true,
};

const order: Order = {
    id: orderId,
    code: 'ORD-000001',
    customer: {
        id: customerId,
        code: 'CUS-000001',
        name: 'Customer',
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
    },
    commercialState: 'CONFIRMED',
    fulfilmentProgress: 'PARTIALLY_FULFILLED',
    version: 2,
    currency: 'JMD',
    terms: cash,
    totalAmount: '1234.50',
    createdAt: at,
    updatedAt: at,
    lines: [
        {
            id: lineId,
            lineNumber: 1,
            productId,
            productCode: 'PRD-000001',
            productName: 'Live birds',
            kind: 'POULTRY',
            unit: 'EACH',
            orderedQuantity: '10',
            unitPrice: '123.4500',
            lineAmount: '1234.50',
            // Whole-order fulfilled quantity includes other farms; this farm's receipt below is only 3.
            fulfilledQuantity: '7',
            remainingQuantity: '3',
            cancelledQuantity: '0',
            fulfilmentProgress: 'PARTIALLY_FULFILLED',
            isRemoved: false,
        },
    ],
};
const event: Fulfilment = {
    id: eventId,
    code: `FUL-${eventId}`,
    orderId,
    farmId,
    actorUserId: actorId,
    kind: 'POSTING',
    reversesFulfilmentId: null,
    occurredAt: at,
    createdAt: at,
    note: null,
    reference: null,
    lines: [
        {
            id: otherId,
            orderLineId: lineId,
            kind: 'POULTRY',
            unit: 'EACH',
            flockId,
            depletionId: movementId,
            quantity: '3',
            sourceCode: 'FLK-000001',
            reversesLineId: null,
        },
    ],
};
const meta = { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe('M5 shared sales contracts', () => {
    it('keeps catalog definition, produce linkage and poultry eligibility separate from stock', () => {
        expect(createSalesProductSchema.parse({ kind: 'POULTRY', name: ' Live birds ' })).toEqual({
            kind: 'POULTRY',
            name: 'Live birds',
        });
        expect(
            createSalesProductSchema.parse({
                kind: 'PRODUCE',
                name: 'Produce',
                inventoryItemId: itemId,
                expectedInventoryUnit: 'KG',
            }),
        ).toMatchObject({ inventoryItemId: itemId });
        expect(
            updateSalesProductSchema.parse({
                definition: {
                    kind: 'PRODUCE',
                    inventoryItemId: itemId,
                    expectedInventoryUnit: 'KG',
                },
            }),
        ).toHaveProperty('definition');
        expect(updateSalesProductSchema.safeParse({}).success).toBe(false);
        expect(
            createSalesProductSchema.safeParse({
                kind: 'POULTRY',
                name: 'Birds',
                inventoryItemId: itemId,
            }).success,
        ).toBe(false);
        expect(
            createSalesProductSchema.safeParse({
                kind: 'PRODUCE',
                name: 'Produce',
                inventoryItemId: itemId,
            }).success,
        ).toBe(false);
        expect(createPoultryProductSourceSchema.parse({ flockId })).toEqual({ flockId });
        expect(createPoultryProductSourceSchema.safeParse({ flockId, farmId }).success).toBe(false);
    });

    it('accepts poultry/produce lines and normalizes exact quantities/prices without floating point', () => {
        const parsed = createOrderSchema.parse(draft);
        expect(parsed.lines.map((line) => [line.quantity, line.unitPrice])).toEqual([
            ['10', '123.4500'],
            ['1.125', '900.0001'],
        ]);
        expect(salesQuantitySchema.parse('1.100')).toBe('1.1');
        expect(salesQuantitySchema.parse('999999999999999.999')).toBe('999999999999999.999');
        for (const unit of ['KG', 'G', 'L', 'ML'])
            expect(
                orderLineInputSchema.parse({
                    ...produceLine,
                    expectedProduct: { ...produceLine.expectedProduct, unit },
                }).quantity,
            ).toBe('1.125');
        expect(
            orderLineInputSchema.parse({
                ...produceLine,
                expectedProduct: { ...produceLine.expectedProduct, unit: 'EACH' },
                quantity: '2.000',
            }).quantity,
        ).toBe('2');
        expect(salesUnitPriceSchema.parse('0')).toBe('0.0000');
        expect(salesUnitPriceSchema.parse('999999999999999.9999')).toBe('999999999999999.9999');
        expect(orderAmountSchema.parse('1234.50')).toBe('1234.50');
        expect(
            createOrderSchema.parse({ ...draft, terms: { saleType: 'CREDIT', creditTermDays: 30 } })
                .terms,
        ).toEqual({ saleType: 'CREDIT', creditTermDays: 30 });
    });

    it('rejects fractional birds/EACH, excessive quantities and numeric or imprecise money', () => {
        for (const quantity of ['0', '-1', '1.5', '2147483648', 10])
            expect(orderLineInputSchema.safeParse({ ...poultryLine, quantity }).success).toBe(
                false,
            );
        for (const quantity of ['0', '-1', '0.0001', '1000000000000000', '1e3', '', 1.125])
            expect(orderLineInputSchema.safeParse({ ...produceLine, quantity }).success).toBe(
                false,
            );
        expect(
            orderLineInputSchema.safeParse({
                ...produceLine,
                expectedProduct: { ...produceLine.expectedProduct, unit: 'EACH' },
            }).success,
        ).toBe(false);
        expect(
            orderLineInputSchema.parse({ ...poultryLine, quantity: '2147483647.000' }).quantity,
        ).toBe('2147483647');
        for (const unitPrice of [
            '-1',
            '0.00001',
            '1000000000000000',
            '999999999999999.99999',
            '1e2',
            'NaN',
            '01.00',
            0.1 + 0.2,
        ])
            expect(orderLineInputSchema.safeParse({ ...produceLine, unitPrice }).success).toBe(
                false,
            );
        for (const amount of ['1', '1.001', '-1.00', 1.23])
            expect(orderAmountSchema.safeParse(amount).success).toBe(false);
    });

    it('restricts JMD and cash/credit period intent without due dates or payment claims', () => {
        expect(createOrderSchema.safeParse({ ...draft, currency: 'USD' }).success).toBe(false);
        for (const terms of [
            { saleType: 'CASH', creditTermDays: 30 },
            { saleType: 'CREDIT', creditTermDays: 0 },
            { saleType: 'CREDIT', creditTermDays: 1.5 },
            { saleType: 'CREDIT', creditTermDays: null },
            { ...cash, paid: true },
            { saleType: 'CREDIT', creditTermDays: 30, dueDate: '2026-12-13' },
        ])
            expect(commercialTermsSchema.safeParse(terms).success).toBe(false);
    });

    it('rejects server authority, derived totals and ledger IDs on every relevant write boundary', () => {
        const inputs = [
            [createOrderSchema, draft],
            [amendOrderSchema, { expectedOrderVersion: 1, customerId }],
            [createSalesProductSchema, { kind: 'POULTRY', name: 'Birds' }],
            [postFulfilmentSchema, posting],
            [reverseFulfilmentSchema, correction],
        ] as const;
        for (const [schema, input] of inputs) {
            for (const field of [
                'organizationId',
                'farmId',
                'actorUserId',
                'role',
                'permissions',
                'code',
                'isActive',
                'createdAt',
                'commercialState',
                'totalAmount',
                'inventoryMovementId',
                'depletionId',
                'paid',
            ])
                expect(
                    schema.safeParse({ ...input, [field]: actorId }).success,
                    `${field} must be server-owned`,
                ).toBe(false);
        }
        expect(
            createOrderSchema.safeParse({
                ...draft,
                lines: [{ ...poultryLine, remainingQuantity: '100' }],
            }).success,
        ).toBe(false);
        expect(
            orderLineInputSchema.safeParse({
                ...poultryLine,
                expectedProduct: { ...poultryLine.expectedProduct, flockId },
            }).success,
        ).toBe(false);
        expect(
            postFulfilmentSchema.safeParse({
                ...posting,
                allocations: [{ ...allocation, depletionId: movementId }],
            }).success,
        ).toBe(false);
    });

    it('allows explicit draft line amendments and rejects duplicate/no-op line operations', () => {
        expect(
            amendOrderSchema.parse({
                expectedOrderVersion: 1,
                lines: [
                    { operation: 'ADD', line: poultryLine },
                    { operation: 'UPDATE', lineId, line: produceLine },
                    { operation: 'REMOVE', lineId: otherId },
                ],
            }).lines,
        ).toHaveLength(3);
        expect(amendOrderSchema.safeParse({ expectedOrderVersion: 1 }).success).toBe(false);
        expect(
            amendOrderSchema.safeParse({
                expectedOrderVersion: 1,
                lines: [
                    { operation: 'REMOVE', lineId },
                    { operation: 'UPDATE', lineId, line: produceLine },
                ],
            }).success,
        ).toBe(false);
        expect(createOrderSchema.safeParse({ ...draft, lines: [] }).success).toBe(false);
        expect(
            createOrderSchema.safeParse({ ...draft, lines: Array(101).fill(poultryLine) }).success,
        ).toBe(false);
    });

    it('models explicit partial multi-source fulfilment and requires unambiguous source discriminators', () => {
        expect(
            postFulfilmentSchema.parse({
                ...posting,
                occurredAt: '2026-11-13T07:00:00-05:00',
                allocations: [
                    allocation,
                    {
                        orderLineId: otherId,
                        kind: 'PRODUCE',
                        inventoryItemId: itemId,
                        quantity: '1.125',
                    },
                ],
            }).occurredAt,
        ).toBe(at);
        for (const invalid of [
            { ...allocation, kind: 'INVENTORY' },
            { ...allocation, inventoryItemId: itemId },
            { orderLineId: lineId, kind: 'PRODUCE', flockId, quantity: '1' },
            { ...allocation, quantity: '0.5' },
        ])
            expect(
                postFulfilmentSchema.safeParse({ ...posting, allocations: [invalid] }).success,
            ).toBe(false);
        expect(
            postFulfilmentSchema.safeParse({ ...posting, allocations: [allocation, allocation] })
                .success,
        ).toBe(false);
        expect(
            postFulfilmentSchema.safeParse({ ...posting, allocations: Array(101).fill(allocation) })
                .success,
        ).toBe(false);
    });

    it('separates normalized idempotency headers from quantities and permits only full posting-error corrections', () => {
        expect(fulfilmentRequestHeadersSchema.parse({ 'idempotency-key': key })).toEqual({
            'idempotency-key': key,
        });
        expect(
            fulfilmentRequestHeadersSchema.safeParse({ 'idempotency-key': `${key},${key}` })
                .success,
        ).toBe(false);
        expect(postFulfilmentSchema.safeParse({ ...posting, idempotencyKey: key }).success).toBe(
            false,
        );
        expect(reverseFulfilmentSchema.parse(correction).postingErrorConfirmed).toBe(true);
        for (const extra of [
            { postingErrorConfirmed: false },
            { reason: ' ' },
            { quantity: '1' },
            { returnId: eventId },
        ])
            expect(reverseFulfilmentSchema.safeParse({ ...correction, ...extra }).success).toBe(
                false,
            );
    });

    it('exposes whole-order commercial values in redacted responses without source identifiers at any depth', () => {
        const redacted = { ...order, sourceDetails: { visibility: 'REDACTED' } };
        const parsed = orderDetailResponseSchema.parse({ data: redacted });
        expect(parsed.data.totalAmount).toBe('1234.50');
        expect(parsed.data.lines[0].fulfilledQuantity).toBe('7');
        for (const sourceDetails of [
            { visibility: 'REDACTED', farmId },
            { visibility: 'REDACTED', history: { data: [event], meta } },
        ])
            expect(
                orderDetailResponseSchema.safeParse({ data: { ...order, sourceDetails } }).success,
            ).toBe(false);
        expect(orderSchema.safeParse({ ...order, farmId }).success).toBe(false);
        expect(
            orderDetailResponseSchema.safeParse({
                data: { ...redacted, lines: [{ ...order.lines[0], flockId }] },
            }).success,
        ).toBe(false);
        expect(
            orderDetailResponseSchema.safeParse({
                data: {
                    ...redacted,
                    customer: { ...order.customer, inventoryMovementId: movementId },
                },
            }).success,
        ).toBe(false);
    });

    it('bounds authorized source history to its explicit farm/order while retaining whole-order totals', () => {
        const detail = {
            ...order,
            sourceDetails: { visibility: 'AUTHORIZED', farmId, history: { data: [event], meta } },
        };
        expect(
            orderDetailResponseSchema.parse({ data: detail }).data.lines[0].fulfilledQuantity,
        ).toBe('7');
        for (const bad of [
            { ...event, farmId: otherId },
            { ...event, orderId: otherId },
        ])
            expect(
                orderDetailResponseSchema.safeParse({
                    data: {
                        ...detail,
                        sourceDetails: { ...detail.sourceDetails, history: { data: [bad], meta } },
                    },
                }).success,
            ).toBe(false);
        // Shape selection is not permission verification; only future verified server context can authorize this farm.
    });

    it('represents immutable poultry depletion and produce ISSUE/ADJUSTMENT history without writable ledger links', () => {
        const produceEvent = {
            ...event,
            lines: [
                {
                    id: otherId,
                    orderLineId: lineId,
                    kind: 'PRODUCE',
                    unit: 'KG',
                    inventoryItemId: itemId,
                    inventoryMovementId: movementId,
                    quantity: '1.125',
                    sourceCode: 'INV-1',
                    reversesLineId: null,
                    movementReason: 'ISSUE',
                },
            ],
        };
        expect(fulfilmentSchema.parse(produceEvent).kind).toBe('POSTING');
        const reversed = {
            ...produceEvent,
            id: otherId,
            kind: 'REVERSAL',
            reversesFulfilmentId: event.id,
            reason: 'Posting error',
            postingErrorConfirmed: true,
            lines: [
                {
                    ...produceEvent.lines[0],
                    reversesLineId: produceEvent.lines[0].id,
                    movementReason: 'ADJUSTMENT',
                },
            ],
        };
        expect(fulfilmentSchema.parse(reversed).kind).toBe('REVERSAL');
        expect(
            fulfilmentSchema.safeParse({
                ...reversed,
                lines: [{ ...reversed.lines[0], movementReason: 'ISSUE' }],
            }).success,
        ).toBe(false);
        expect(
            fulfilmentSchema.safeParse({
                ...event,
                lines: [{ ...event.lines[0], inventoryItemId: itemId }],
            }).success,
        ).toBe(false);
        const depletion = {
            id: movementId,
            farmId,
            flockId,
            fulfilmentLineId: otherId,
            birdCount: 3,
            reversesDepletionId: null,
            actorUserId: actorId,
            occurredAt: at,
            createdAt: at,
        };
        expect(flockSaleDepletionSchema.parse(depletion).birdCount).toBe(3);
        expect(flockSaleDepletionSchema.safeParse({ ...depletion, birdCount: 0.5 }).success).toBe(
            false,
        );
        expect(
            fulfilmentCommandReceiptSchema.parse({
                operation: 'POST',
                idempotencyKey: key,
                orderVersion: 2,
                fulfilment: event,
            }).fulfilment.id,
        ).toBe(event.id);
        expect(
            fulfilmentCommandReceiptSchema.safeParse({
                operation: 'REVERSE',
                idempotencyKey: key,
                orderVersion: 2,
                fulfilment: event,
            }).success,
        ).toBe(false);
    });

    it('uses shared bounded pagination and sales lifecycle filters rather than payment states', () => {
        for (const schema of [salesProductQuerySchema, orderQuerySchema, fulfilmentQuerySchema]) {
            expect(schema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
            expect(schema.parse({ page: '1000000', pageSize: '100' })).toMatchObject({
                page: 1_000_000,
                pageSize: 100,
            });
            for (const invalid of [{ page: 1_000_001 }, { pageSize: 101 }, { farmId }])
                expect(schema.safeParse(invalid).success).toBe(false);
        }
        expect(orderQuerySchema.safeParse({ state: 'PAID' }).success).toBe(false);
        expect(fulfilmentQuerySchema.safeParse({ kind: 'RETURN' }).success).toBe(false);
        expect(salesProductQuerySchema.safeParse({ kind: 'LIVESTOCK' }).success).toBe(false);
    });

    it('activates LOCK unit preconditions while POP population contracts remain staged', () => {
        const feed = { inventoryItemId: itemId, quantity: '1.125', occurredAt: at };
        const movement = { ...feed, quantity: 1, reason: 'RECEIPT' };
        expect(postFeedUsageSchema.safeParse(feed).success).toBe(false);
        expect(createInventoryMovementSchema.safeParse(movement).success).toBe(false);
        expect(postFeedUsageV2Schema.safeParse(feed).success).toBe(false);
        expect(createInventoryMovementV2Schema.safeParse(movement).success).toBe(false);
        expect(
            postFeedUsageV2Schema.safeParse({ ...feed, expectedInventoryUnit: 'KG' }).success,
        ).toBe(true);
        expect(
            createInventoryMovementV2Schema.safeParse({ ...movement, expectedInventoryUnit: 'KG' })
                .success,
        ).toBe(true);
        const legacy: FlockMetrics = {
            ageAndMaturityAsOfDate: '2026-11-13',
            startingBirdCount: 100,
            cumulativeMortality: 10,
            liveBirdCount: 90,
            mortalityPercentage: '10',
            ageDays: 1,
            ageWeeks: 0,
            daysToMaturity: null,
            maturityState: 'NO_EXPECTED_MATURITY_DATE',
            cumulativeFeedUsage: [],
        };
        expect(flockMetricsV2Schema.safeParse(legacy).success).toBe(false);
        expect(
            flockMetricsV2Schema.parse({
                ...legacy,
                liveBirdCount: 20,
                effectiveFulfilledBirdCount: 70,
            }),
        ).toMatchObject({ cumulativeMortality: 10, mortalityPercentage: '10', liveBirdCount: 20 });
    });
});
