import { z } from 'zod';

export const paginationQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict();

export const activeStatusQuerySchema = z
    .enum(['true', 'false'])
    .transform((value) => value === 'true');

/** Server response metadata is numeric; unlike query parameters it is not coerced. */
export const paginationMetaSchema = z
    .object({
        page: z.number().int().min(1).max(1_000_000),
        pageSize: z.number().int().min(1).max(100),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
    })
    .strict();
