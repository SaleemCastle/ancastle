import { z } from 'zod';
import {
    FLOCK_MATURITY_STATES,
    INVENTORY_UNITS,
    type FlockMetricsV2,
    type FlockWithMetricsV2,
} from '@ancastle/types';
import { paginationMetaSchema } from './pagination.js';

/** Active M5-POP response shape. Current flock API routes require and validate S-M-B. */
export const flockMetricsV2Schema = z
    .object({
        ageAndMaturityAsOfDate: z.iso.date(),
        startingBirdCount: z.number().int().min(1).max(2_147_483_647),
        cumulativeMortality: z.number().int().min(0).max(2_147_483_647),
        effectiveFulfilledBirdCount: z.number().int().min(0).max(2_147_483_647),
        liveBirdCount: z.number().int().min(0).max(2_147_483_647),
        mortalityPercentage: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
        ageDays: z.number().int().nonnegative(),
        ageWeeks: z.number().int().nonnegative(),
        daysToMaturity: z.number().int().nonnegative().nullable(),
        maturityState: z.enum(FLOCK_MATURITY_STATES),
        cumulativeFeedUsage: z.array(
            z
                .object({
                    inventoryItemId: z.uuid(),
                    unit: z.enum(INVENTORY_UNITS),
                    // Aggregate totals may exceed one event's Decimal(18,3), including zero after reversal.
                    quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/),
                })
                .strict(),
        ),
    })
    .strict()
    .superRefine((metrics, ctx) => {
        const committed = metrics.cumulativeMortality + metrics.effectiveFulfilledBirdCount;
        const expectedLive = metrics.startingBirdCount - committed;
        if (committed > metrics.startingBirdCount || metrics.liveBirdCount !== expectedLive) {
            ctx.addIssue({
                code: 'custom',
                path: ['liveBirdCount'],
                message: 'Live bird count must equal starting birds less net mortality and sales',
            });
        }
    }) satisfies z.ZodType<FlockMetricsV2>;

export const flockWithMetricsV2Schema = z
    .object({
        id: z.uuid(),
        farmId: z.uuid(),
        code: z.string(),
        name: z.string(),
        birdType: z.string().nullable(),
        placementDate: z.iso.date(),
        startingBirdCount: z.number().int().min(1).max(2_147_483_647),
        expectedMaturityDate: z.iso.date().nullable(),
        notes: z.string().nullable(),
        isActive: z.boolean(),
        createdAt: z.iso.datetime({ offset: true }),
        updatedAt: z.iso.datetime({ offset: true }),
        metrics: flockMetricsV2Schema,
    })
    .strict() satisfies z.ZodType<FlockWithMetricsV2>;
export const flockDetailV2ResponseSchema = z.object({ data: flockWithMetricsV2Schema }).strict();
export const flockMetricsListV2ResponseSchema = z
    .object({
        data: z.array(flockWithMetricsV2Schema).max(100),
        meta: paginationMetaSchema,
    })
    .strict();
