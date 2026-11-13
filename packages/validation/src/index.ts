import {
    CUSTOMER_TYPES,
    INVENTORY_CATEGORIES,
    INVENTORY_UNITS,
    INVENTORY_MOVEMENT_REASONS,
    FLOCK_MATURITY_STATES,
} from '@ancastle/types';
import { z } from 'zod';
import { activeStatusQuerySchema, paginationQuerySchema } from './pagination.js';

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

// Dates stay as real YYYY-MM-DD calendar strings, matching Flock's PostgreSQL DATE
// columns. Do not coerce timestamps/Date objects or apply timezone conversion.
const flockDateSchema = z.iso.date();
const startingBirdCountSchema = z.number().int().min(1).max(2_147_483_647);

const flockFields = {
    name: requiredNameSchema,
    birdType: optionalTextSchema(120),
    placementDate: flockDateSchema,
    startingBirdCount: startingBirdCountSchema,
    expectedMaturityDate: z.preprocess(blankToUndefined, flockDateSchema.optional()),
    notes: optionalTextSchema(2000),
};

function validFlockDates(data: {
    placementDate?: string;
    expectedMaturityDate?: string | null;
}): boolean {
    return (
        !data.placementDate ||
        !data.expectedMaturityDate ||
        data.expectedMaturityDate >= data.placementDate
    );
}

const flockDateOrderError = {
    message: 'Expected maturity date must be on or after placement date',
    path: ['expectedMaturityDate'],
};

export const createFlockSchema = z
    .object(flockFields)
    .strict()
    .refine(validFlockDates, flockDateOrderError);

// A one-date PATCH cannot validate against a missing persisted counterpart.
// The consuming service must validate the merged dates before persistence.
export const updateFlockSchema = z
    .object({
        ...flockFields,
        birdType: nullableTextSchema(120),
        expectedMaturityDate: z.preprocess(blankToNull, flockDateSchema.nullable()),
        notes: nullableTextSchema(2000),
    })
    .partial()
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided',
    })
    .refine(validFlockDates, flockDateOrderError);

// Search is intended for code/name/bird-type text. birdType is an exact label
// filter, not an enum. isActive=false selects closed flocks; omission means all.
// Organization and farm scope must come from verified context, not this query.
export const flockQuerySchema = paginationQuerySchema
    .extend({
        search: optionalTextSchema(120),
        birdType: optionalTextSchema(120),
        isActive: activeStatusQuerySchema.optional(),
    })
    .strict();

export type CreateFlockInput = z.infer<typeof createFlockSchema>;
export type UpdateFlockInput = z.infer<typeof updateFlockSchema>;
export type FlockQuery = z.infer<typeof flockQuerySchema>;

// This date affects age/maturity only. Ledger totals always include all postings.
export const flockMetricsQuerySchema = z
    .object({
        ageAndMaturityAsOfDate: flockDateSchema,
    })
    .strict();
export const flockApiQuerySchema = flockQuerySchema
    .extend({
        ageAndMaturityAsOfDate: flockDateSchema,
        maturityState: z.enum(FLOCK_MATURITY_STATES).optional(),
    })
    .strict();
export const poultryHistoryQuerySchema = paginationQuerySchema;
export const flockLifecycleSchema = z.object({}).strict().default({});
const poultryPostingFields = {
    occurredAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    note: optionalTextSchema(2000),
    reference: optionalTextSchema(120),
};
export const postMortalitySchema = z
    .object({
        ...poultryPostingFields,
        deathCount: startingBirdCountSchema,
        cause: optionalTextSchema(120),
    })
    .strict();
export const postFeedUsageSchema = z
    .object({
        ...poultryPostingFields,
        inventoryItemId: z.uuid(),
        // Decimal strings retain the full PostgreSQL precision; ordinary JSON
        // numbers are accepted when their canonical value fits the same scale.
        quantity: z
            .union([z.string(), z.number().finite().transform(String)])
            .pipe(z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/))
            .refine((value) => /[1-9]/.test(value), 'Quantity must be positive'),
    })
    .strict();
export type FlockMetricsQuery = z.infer<typeof flockMetricsQuerySchema>;
export type FlockApiQuery = z.infer<typeof flockApiQuerySchema>;
export type PoultryHistoryQuery = z.infer<typeof poultryHistoryQuerySchema>;
export type PostMortalityInput = z.infer<typeof postMortalitySchema>;
export type PostFeedUsageInput = z.infer<typeof postFeedUsageSchema>;

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
export * from './sales.js';
export * from './sales-v2.js';

// Staged LOCK contracts only. Do not change the existing M3/M4 exports until
// their producers, actions and services are migrated in the coordinated cutover.
export const createInventoryMovementV2Schema = createInventoryMovementSchema
    .extend({ expectedInventoryUnit: z.enum(INVENTORY_UNITS) })
    .strict();
export const postFeedUsageV2Schema = postFeedUsageSchema
    .extend({ expectedInventoryUnit: z.enum(INVENTORY_UNITS) })
    .strict();
export type CreateInventoryMovementV2Input = z.infer<typeof createInventoryMovementV2Schema>;
export type PostFeedUsageV2Input = z.infer<typeof postFeedUsageV2Schema>;
