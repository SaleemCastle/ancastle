import { z } from 'zod';
import { ORGANIZATION_ROLES } from '@ancastle/types';
import { loginSchema } from './auth.js';
import { paginationQuerySchema, activeStatusQuerySchema } from './pagination.js';

export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);
const memberDisplayName = z.string().trim().min(1).max(120).nullable();
const assignedFarmIds = z
    .array(z.uuid())
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, 'Farm IDs must be unique');

export const bootstrapOrganizationUserSchema = z
    .object({
        email: loginSchema.shape.email,
        password: z.string().min(12).max(128),
        displayName: memberDisplayName.default(null),
        role: organizationRoleSchema.default('STAFF'),
        farmIds: assignedFarmIds.default([]),
    })
    .strict();

export const memberProfileUpdateSchema = z.object({ displayName: memberDisplayName }).strict();
export const membershipUpdateSchema = z
    .object({
        role: organizationRoleSchema.optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export const memberFarmAccessSchema = z.object({ farmIds: assignedFarmIds }).strict();

// Status refers to the organization membership.
export const organizationMemberListQuerySchema = paginationQuerySchema
    .extend({
        isActive: activeStatusQuerySchema.optional(),
    })
    .strict();

export type BootstrapOrganizationUserInput = z.infer<typeof bootstrapOrganizationUserSchema>;
export type MemberProfileUpdateInput = z.infer<typeof memberProfileUpdateSchema>;
export type MembershipUpdateInput = z.infer<typeof membershipUpdateSchema>;
export type MemberFarmAccessInput = z.infer<typeof memberFarmAccessSchema>;
export type OrganizationMemberListQuery = z.infer<typeof organizationMemberListQuerySchema>;

export const organizationMemberSchema = z.object({
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    email: z.email(),
    userIsActive: z.boolean(),
    displayName: z.string().nullable(),
    role: organizationRoleSchema,
    isActive: z.boolean(),
    farmAccess: z.object({ allFarms: z.boolean(), farmIds: z.array(z.uuid()) }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});
export const organizationMemberResponseSchema = z.object({ data: organizationMemberSchema });
export const organizationMemberListResponseSchema = z.object({
    data: z.array(organizationMemberSchema),
    meta: z.object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
    }),
});
