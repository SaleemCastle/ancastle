import {
    CUSTOMER_TYPES,
    INVENTORY_CATEGORIES,
    INVENTORY_UNITS,
    INVENTORY_MOVEMENT_REASONS,
} from '@ancastle/types';
import { z } from 'zod';

export const healthStatusSchema = z.object({
    status: z.enum(['ok', 'error']),
    service: z.string().min(1),
    timestamp: z.iso.datetime(),
    dependencies: z.object({
        database: z.enum(['up', 'down']),
        redis: z.enum(['up', 'down']),
    }),
});

const blankToUndefined = (value: unknown) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();

    return trimmed === '' ? undefined : trimmed;
};

export const requiredNameSchema = z.string().trim().min(1).max(120);

const inventoryDecimalSchema = z.coerce
    .number()
    .finite()
    .min(0)
    .refine((value) => Number.isInteger(value * 1000), {
        message: 'Must have at most 3 decimal places',
    });

const nonNegativeDecimalSchema = z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') {
        return undefined;
    }

    return value;
}, z.coerce.number().finite().min(0));

const nullableNonNegativeDecimalSchema = z.preprocess((value) => {
    if (value === null) {
        return null;
    }

    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }

    return value;
}, inventoryDecimalSchema.nullable());

export const optionalTextSchema = (maxLength: number) =>
    z.preprocess(blankToUndefined, z.string().max(maxLength).optional());

export const optionalEmailSchema = z.preprocess(
    blankToUndefined,
    z.string().trim().toLowerCase().email().max(254).optional(),
);

export const optionalPhoneSchema = z.preprocess(blankToUndefined, z.string().max(30).optional());

const blankToNull = (value: unknown) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();

    return trimmed === '' ? null : trimmed;
};

const nullableTextSchema = (maxLength: number) =>
    z.preprocess(blankToNull, z.string().max(maxLength).nullable());

const nullableEmailSchema = z.preprocess(
    blankToNull,
    z.string().trim().toLowerCase().email().max(254).nullable(),
);

const nullablePhoneSchema = z.preprocess(blankToNull, z.string().max(30).nullable());

const customerFields = {
    type: z.enum(CUSTOMER_TYPES),
    name: requiredNameSchema,
    contactPerson: optionalTextSchema(120),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    address: optionalTextSchema(500),
    notes: optionalTextSchema(2000),
};

const supplierFields = {
    name: requiredNameSchema,
    contactPerson: optionalTextSchema(120),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    address: optionalTextSchema(500),
    notes: optionalTextSchema(2000),
};

const inventoryItemFields = {
    name: requiredNameSchema,
    description: optionalTextSchema(1000),
    unit: z.enum(INVENTORY_UNITS),
    category: z.enum(INVENTORY_CATEGORIES),
    lowStockThreshold: nonNegativeDecimalSchema.optional(),
};

const inventoryItemUpdateFields = {
    name: requiredNameSchema,
    description: nullableTextSchema(1000),
    unit: z.enum(INVENTORY_UNITS),
    category: z.enum(INVENTORY_CATEGORIES),
    lowStockThreshold: nullableNonNegativeDecimalSchema,
};

const customerUpdateFields = {
    type: z.enum(CUSTOMER_TYPES),
    name: requiredNameSchema,
    contactPerson: nullableTextSchema(120),
    phone: nullablePhoneSchema,
    email: nullableEmailSchema,
    address: nullableTextSchema(500),
    notes: nullableTextSchema(2000),
};

const supplierUpdateFields = {
    name: requiredNameSchema,
    contactPerson: nullableTextSchema(120),
    phone: nullablePhoneSchema,
    email: nullableEmailSchema,
    address: nullableTextSchema(500),
    notes: nullableTextSchema(2000),
};

export const createCustomerSchema = z.object(customerFields).strict();

export const updateCustomerSchema = z
    .object(customerUpdateFields)
    .partial()
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export const createSupplierSchema = z.object(supplierFields).strict();

export const updateSupplierSchema = z
    .object(supplierUpdateFields)
    .partial()
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const masterDataQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        search: optionalTextSchema(120),
        isActive: booleanQuerySchema.optional(),
    })
    .strict();

export const createInventoryItemSchema = z.object(inventoryItemFields).strict();

export const updateInventoryItemSchema = z
    .object(inventoryItemUpdateFields)
    .partial()
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    });

export const inventoryQuerySchema = masterDataQuerySchema;

export const inventoryMovementQuantitySchema = z.coerce
    .number()
    .finite()
    .refine((value) => value !== 0, {
        message: 'Movement quantity must not be zero',
    })
    .refine((value) => Number.isInteger(value * 1000), {
        message: 'Must have at most 3 decimal places',
    });

export const createInventoryMovementSchema = z
    .object({
        inventoryItemId: z.uuid(),
        quantity: inventoryMovementQuantitySchema,
        reason: z.enum(INVENTORY_MOVEMENT_REASONS),
        occurredAt: z.coerce.date(),
        note: optionalTextSchema(2000),
        reference: optionalTextSchema(120),
    })
    .strict();

export const inventoryMovementQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        inventoryItemId: z.uuid().optional(),
        reason: z.enum(INVENTORY_MOVEMENT_REASONS).optional(),
    })
    .strict();

export type HealthStatusInput = z.input<typeof healthStatusSchema>;
export type HealthStatusOutput = z.output<typeof healthStatusSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export type MasterDataQuery = z.infer<typeof masterDataQuerySchema>;

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export type CreateInventoryMovementInput = z.infer<typeof createInventoryMovementSchema>;

export type InventoryMovementQuery = z.infer<typeof inventoryMovementQuerySchema>;

export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
export * from './pagination.js';
