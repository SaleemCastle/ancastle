import { z } from 'zod';
import { paginationQuerySchema, activeStatusQuerySchema } from './pagination.js';

const displayName = z.string().trim().min(1).max(120);
const farmCode = z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Use letters, digits, underscores or hyphens')
    .transform((value) => value.toUpperCase());

export const organizationProfileUpdateSchema = z.object({ name: displayName }).strict();

export const createFarmSchema = z
    .object({
        name: displayName,
        code: farmCode,
    })
    .strict();

export const updateFarmSchema = z
    .object({
        name: displayName.optional(),
        code: farmCode.optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');

export const farmListQuerySchema = paginationQuerySchema
    .extend({
        isActive: activeStatusQuerySchema.optional(),
    })
    .strict();

export const resourceIdSchema = z.uuid();

export type OrganizationProfileUpdateInput = z.infer<typeof organizationProfileUpdateSchema>;
export type CreateFarmInput = z.infer<typeof createFarmSchema>;
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;
export type FarmListQuery = z.infer<typeof farmListQuerySchema>;
