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

export * from './api.js';
export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
