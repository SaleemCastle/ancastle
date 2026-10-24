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
