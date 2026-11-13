import type { ApiResponse, PaginatedResponse } from './api.js';
import type { InventoryUnit } from './index.js';

/** Sales domain contracts; staged M4 population cutover contracts live in sales-v2.ts. */
export const SALES_PRODUCT_KINDS = ['POULTRY', 'PRODUCE'] as const;
export type SalesProductKind = (typeof SALES_PRODUCT_KINDS)[number];
export const ORDER_STATES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const FULFILMENT_PROGRESS_STATES = [
    'UNFULFILLED',
    'PARTIALLY_FULFILLED',
    'FULFILLED',
] as const;
export type FulfilmentProgress = (typeof FULFILMENT_PROGRESS_STATES)[number];
export const FULFILMENT_KINDS = ['POSTING', 'REVERSAL'] as const;
export const SALES_CURRENCY = 'JMD' as const;

/** Wire decimals are strings; validation owns precision, never JS floating point. */
export type SalesQuantity = string;
export type SalesUnitPrice = string;
export type OrderAmount = string;

export type CommercialTerms =
    { saleType: 'CASH'; creditTermDays: null } | { saleType: 'CREDIT'; creditTermDays: number };

interface SalesProductDefinition {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
/** Catalog identity has no farm balance, reservation or price. */
export type SalesProduct = SalesProductDefinition &
    (
        | { kind: 'POULTRY'; unit: 'EACH' }
        | { kind: 'PRODUCE'; unit: InventoryUnit; inventoryItemId: string }
    );

export interface PoultryProductSource {
    id: string;
    productId: string;
    farmId: string;
    flockId: string;
    flockCode: string;
    flockName: string;
    flockIsActive: boolean;
    productIsActive: boolean;
    isActive: boolean;
    /** Derived eligibility, not a reservation or a bird balance. */
    isEligible: boolean;
    actorUserId: string;
    createdAt: string;
    updatedAt: string;
}

export interface CustomerSnapshot {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly contactPerson: string | null;
    readonly phone: string | null;
    readonly email: string | null;
    readonly address: string | null;
}

interface CommercialOrderLine {
    id: string;
    lineNumber: number;
    readonly productId: string;
    readonly productCode: string;
    readonly productName: string;
    readonly orderedQuantity: SalesQuantity;
    /** Immutable on confirmation; draft edits use separate command contracts. */
    readonly unitPrice: SalesUnitPrice;
    lineAmount: OrderAmount;
    fulfilledQuantity: SalesQuantity;
    /** Open commercial demand; never physical stock or guaranteed availability. */
    remainingQuantity: SalesQuantity;
    cancelledQuantity: SalesQuantity;
    fulfilmentProgress: FulfilmentProgress | null;
    isRemoved: boolean;
}
/** Commercial responses deliberately contain no farm/flock/item/ledger references. */
export type OrderLine = CommercialOrderLine &
    ({ kind: 'POULTRY'; unit: 'EACH' } | { kind: 'PRODUCE'; unit: InventoryUnit });

export interface OrderSummary {
    id: string;
    code: string;
    customer: Pick<CustomerSnapshot, 'id' | 'code' | 'name'>;
    commercialState: OrderState;
    fulfilmentProgress: FulfilmentProgress | null;
    version: number;
    currency: typeof SALES_CURRENCY;
    terms: CommercialTerms;
    /** Whole-order commercial total across all farms; not an amount receivable. */
    totalAmount: OrderAmount;
    createdAt: string;
    updatedAt: string;
}
/** Confirmation does not reserve supply. CASH does not imply payment. */
export interface Order extends Omit<OrderSummary, 'customer'> {
    customer: CustomerSnapshot;
    lines: OrderLine[];
}

interface FulfilmentAllocation {
    id: string;
    orderLineId: string;
    quantity: SalesQuantity;
    sourceCode: string;
}
type PoultryAllocation = { kind: 'POULTRY'; unit: 'EACH'; flockId: string; depletionId: string };
type ProduceAllocation = {
    kind: 'PRODUCE';
    unit: InventoryUnit;
    inventoryItemId: string;
    inventoryMovementId: string;
};
export type FulfilmentPostingLine = FulfilmentAllocation & { reversesLineId: null } & (
        PoultryAllocation | (ProduceAllocation & { movementReason: 'ISSUE' })
    );
export type FulfilmentReversalLine = FulfilmentAllocation & { reversesLineId: string } & (
        PoultryAllocation | (ProduceAllocation & { movementReason: 'ADJUSTMENT' })
    );
export type FulfilmentLine = FulfilmentPostingLine | FulfilmentReversalLine;

interface FarmFulfilment {
    id: string;
    code: string;
    orderId: string;
    farmId: string;
    actorUserId: string;
    occurredAt: string;
    createdAt: string;
    note: string | null;
    reference: string | null;
}
/** Immutable physical event; reversal is full posting-error compensation, not a return. */
export type Fulfilment = FarmFulfilment &
    (
        | {
              kind: 'POSTING';
              reversesFulfilmentId: null;
              lines: FulfilmentPostingLine[];
          }
        | {
              kind: 'REVERSAL';
              reversesFulfilmentId: string;
              reason: string;
              postingErrorConfirmed: true;
              lines: FulfilmentReversalLine[];
          }
    );

export interface FlockSaleDepletion {
    id: string;
    farmId: string;
    flockId: string;
    fulfilmentLineId: string;
    /** Positive whole birds; a reversal subtracts this count from effective depletion. */
    birdCount: number;
    reversesDepletionId: string | null;
    actorUserId: string;
    occurredAt: string;
    createdAt: string;
}

export interface RedactedOrderSources {
    visibility: 'REDACTED';
}
/** Select this shape only after fresh farm authorization; schemas cannot grant access. */
export interface AuthorizedOrderSources {
    visibility: 'AUTHORIZED';
    farmId: string;
    /** Only this authorized farm's bounded history; commercial totals remain whole-order. */
    history: PaginatedResponse<Fulfilment>;
}
export type OrderSourceDetails = RedactedOrderSources | AuthorizedOrderSources;
export interface OrderDetail extends Order {
    sourceDetails: OrderSourceDetails;
}
export type RedactedOrderDetail = Order & { sourceDetails: RedactedOrderSources };
export type AuthorizedOrderDetail = Order & { sourceDetails: AuthorizedOrderSources };

/** Original committed result, not a mutable current-order snapshot or a payment receipt. */
export interface FulfilmentCommandReceipt {
    operation: 'POST' | 'REVERSE';
    idempotencyKey: string;
    orderVersion: number;
    fulfilment: Fulfilment;
}

export type SalesProductResponse = ApiResponse<SalesProduct>;
export type SalesProductListResponse = PaginatedResponse<SalesProduct>;
export type PoultryProductSourceResponse = ApiResponse<PoultryProductSource>;
export type PoultryProductSourceListResponse = PaginatedResponse<PoultryProductSource>;
export type OrderResponse = ApiResponse<Order>;
export type OrderListResponse = PaginatedResponse<OrderSummary>;
export type OrderDetailResponse = ApiResponse<OrderDetail>;
export type FulfilmentResponse = ApiResponse<Fulfilment>;
export type FulfilmentListResponse = PaginatedResponse<Fulfilment>;
export type FlockSaleDepletionResponse = ApiResponse<FlockSaleDepletion>;
export type FulfilmentCommandResponse = ApiResponse<FulfilmentCommandReceipt>;
