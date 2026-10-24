import type { HealthStatus } from '@ancastle/types';
import { healthStatusSchema } from '@ancastle/validation';

export function parseHealthStatus(value: unknown): HealthStatus {
    return healthStatusSchema.parse(value);
}
