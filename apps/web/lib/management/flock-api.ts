import 'server-only';
import { z } from 'zod';
import type { Flock } from '@ancastle/types';
import {
    flockDetailV2ResponseSchema,
    flockMetricsListV2ResponseSchema,
    resourceIdSchema,
} from '@ancastle/validation';
import type { ManagementContext } from '@/components/management/page';
import { ManagementApiError, managementApi } from './api';
import { flockMetricsDate } from './flocks';

const flockSchema = z.object({
    id: z.uuid(),
    farmId: z.uuid(),
    code: z.string(),
    name: z.string(),
    birdType: z.string().nullable(),
    placementDate: z.iso.date(),
    startingBirdCount: z.number().int(),
    expectedMaturityDate: z.iso.date().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
}) satisfies z.ZodType<Flock>;
export const flockResponseSchema = z.object({ data: flockSchema });
export const flockDetailResponseSchema = flockDetailV2ResponseSchema;
export const flockListResponseSchema = flockMetricsListV2ResponseSchema;

export function flockScope(context: ManagementContext, manage = false) {
    const { current, farm } = context;
    if (
        !current?.permissions.includes('flock:read') ||
        (manage && !current.permissions.includes('flock:manage'))
    )
        throw new ManagementApiError('FORBIDDEN');
    if (!farm) return null;
    return { organization: current.organization.id, farm: farm.id };
}

export function flockApiPath(scope: { organization: string; farm: string }) {
    return `organizations/${scope.organization}/farms/${scope.farm}/flocks`;
}

export async function loadFlock(scope: { organization: string; farm: string }, value: string) {
    const id = resourceIdSchema.safeParse(value);
    if (!id.success) throw new ManagementApiError('FLOCK_NOT_FOUND');
    return managementApi(
        `${flockApiPath(scope)}/${id.data}?ageAndMaturityAsOfDate=${flockMetricsDate()}`,
        flockDetailResponseSchema,
    );
}
