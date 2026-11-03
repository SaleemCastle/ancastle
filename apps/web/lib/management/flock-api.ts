import 'server-only';
import { z } from 'zod';
import { INVENTORY_UNITS, type Flock, type FlockWithMetrics } from '@ancastle/types';
import { resourceIdSchema } from '@ancastle/validation';
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
const flockWithMetricsSchema = flockSchema.extend({
    metrics: z.object({
        ageAndMaturityAsOfDate: z.iso.date(),
        startingBirdCount: z.number().int(),
        cumulativeMortality: z.number().int(),
        liveBirdCount: z.number().int(),
        mortalityPercentage: z.string(),
        ageDays: z.number().int(),
        ageWeeks: z.number(),
        daysToMaturity: z.number().int().nullable(),
        maturityState: z.enum([
            'BEFORE_EXPECTED_MATURITY',
            'AT_OR_PAST_EXPECTED_MATURITY',
            'NO_EXPECTED_MATURITY_DATE',
        ]),
        cumulativeFeedUsage: z.array(
            z.object({
                inventoryItemId: z.uuid(),
                unit: z.enum(INVENTORY_UNITS),
                quantity: z.string(),
            }),
        ),
    }),
}) satisfies z.ZodType<FlockWithMetrics>;
export const flockDetailResponseSchema = z.object({ data: flockWithMetricsSchema });
export const flockListResponseSchema = z.object({
    data: z.array(flockWithMetricsSchema),
    meta: z.object({
        page: z.number().int().min(1),
        pageSize: z.number().int().min(1),
        totalItems: z.number().int().min(0),
        totalPages: z.number().int().min(0),
    }),
});

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
