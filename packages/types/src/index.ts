export type HealthDependencyStatus = 'up' | 'down';

export interface HealthStatus {
    status: 'ok' | 'error';
    service: string;
    timestamp: string;
    dependencies: {
        database: HealthDependencyStatus;
        redis: HealthDependencyStatus;
    };
}

export * from './api.js';
export * from './auth.js';
export * from './organization-farm.js';
export * from './organization-member.js';

export * from './application-context.js';
