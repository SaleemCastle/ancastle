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

export type HealthStatusInput = z.input<typeof healthStatusSchema>;
export type HealthStatusOutput = z.output<typeof healthStatusSchema>;
export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
export * from './pagination.js';
