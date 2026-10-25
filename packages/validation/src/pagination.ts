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
