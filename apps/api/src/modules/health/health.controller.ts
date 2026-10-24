import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@ancastle/types';
import { healthStatusSchema } from '@ancastle/validation';

@Controller('health')
export class HealthController {
    @Get()
    getHealth(): HealthStatus {
        const response: HealthStatus = {
            status: 'ok',
            service: 'ancastle-api',
            timestamp: new Date().toISOString(),
        };

        return healthStatusSchema.parse(response);
    }
}