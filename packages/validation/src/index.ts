import { z } from 'zod';

export const healthStatusSchema = z.object({
    status: z.literal('ok'),
    service: z.string().min(1),
    timestamp: z.iso.datetime(),
});

export type HealthStatusInput = z.input<typeof healthStatusSchema>;
export type HealthStatusOutput = z.output<typeof healthStatusSchema>;