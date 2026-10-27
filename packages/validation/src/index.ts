import { CUSTOMER_TYPES } from '@ancastle/types';
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

export type HealthStatusInput = z.input<typeof healthStatusSchema>;
export type HealthStatusOutput = z.output<typeof healthStatusSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export type MasterDataQuery = z.infer<typeof masterDataQuerySchema>;

export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
export * from './pagination.js';
