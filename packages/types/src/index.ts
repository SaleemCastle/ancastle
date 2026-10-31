export type HealthDependencyStatus = 'up' | 'down';

export interface HealthStatus {
    status: 'ok' | 'error';
    service: string;
    timestamp: string;
    dependencies: {
        database: HealthDependencyStatus;
        redis: HealthDependencyStatus;
    };
}

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface Customer {
    id: string;
    code: string;
    type: CustomerType;
    name: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Supplier {
    id: string;
    code: string;
    name: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface SupplierResponse {
    data: Supplier;
}

export interface SupplierListResponse {
    data: Supplier[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}

export interface CustomerResponse {
    data: Customer;
}

export interface CustomerListResponse {
    data: Customer[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}

export const INVENTORY_UNITS = ['EACH', 'KG', 'G', 'L', 'ML'] as const;

export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

export const INVENTORY_CATEGORIES = ['FEED', 'VITAMIN', 'PRODUCE', 'SUPPLY', 'OTHER'] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export interface InventoryItem {
    id: string;
    code: string;
    name: string;
    description: string | null;
    unit: InventoryUnit;
    category: InventoryCategory;
    lowStockThreshold: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface InventoryItemResponse {
    data: InventoryItem;
}

export interface InventoryItemListResponse {
    data: InventoryItem[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}

export const INVENTORY_MOVEMENT_REASONS = ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const;

export type InventoryMovementReason = (typeof INVENTORY_MOVEMENT_REASONS)[number];

export const INVENTORY_STOCK_STATUSES = ['HEALTHY', 'LOW', 'OUT_OF_STOCK', 'UNMONITORED'] as const;

export type InventoryStockStatus = (typeof INVENTORY_STOCK_STATUSES)[number];

export interface FarmInventoryItem {
    item: InventoryItem;
    stockOnHand: string;
    stockStatus: InventoryStockStatus;
}

export interface FarmInventoryResponse {
    data: FarmInventoryItem[];
}

export interface InventoryMovement {
    id: string;
    farmId: string;
    inventoryItemId: string;
    actorUserId: string;
    quantity: string;
    reason: InventoryMovementReason;
    occurredAt: string;
    note: string | null;
    reference: string | null;
    createdAt: string;
}

export interface InventoryMovementResponse {
    data: InventoryMovement;
}

export interface InventoryMovementListResponse {
    data: InventoryMovement[];
    meta: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}

export * from './api.js';
export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
