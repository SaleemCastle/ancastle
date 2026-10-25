import { z } from 'zod';
import { organizationRoleSchema } from './organization-member.js';

export const applicationSelectionSchema = z
    .object({
        organization: z.uuid().optional(),
        farm: z.uuid().optional(),
    })
    .strict()
    .refine((value) => !value.farm || Boolean(value.organization));

export const applicationContextResponseSchema = z.object({
    data: z.array(
        z.object({
            organization: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
            membership: z.object({
                displayName: z.string().nullable(),
                role: organizationRoleSchema,
            }),
            permissions: z.array(z.string()),
            farms: z.array(z.object({ id: z.uuid(), name: z.string(), code: z.string() })),
        }),
    ),
    meta: z.object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
    }),
});
