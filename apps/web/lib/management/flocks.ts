import type { Flock, FlockMetrics } from '@ancastle/types';

/** UI/API boundary convention: today is the current UTC calendar date. */
export function flockMetricsDate(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

export function flockMaturityLabel(metrics: FlockMetrics): string {
    switch (metrics.maturityState) {
        case 'BEFORE_EXPECTED_MATURITY':
            return `${metrics.daysToMaturity} days to expected maturity`;
        case 'AT_OR_PAST_EXPECTED_MATURITY':
            return 'At or past expected maturity';
        case 'NO_EXPECTED_MATURITY_DATE':
            return 'No expected maturity date';
    }
}

export const flockFields = [
    'name',
    'birdType',
    'placementDate',
    'startingBirdCount',
    'expectedMaturityDate',
    'notes',
] as const;

/** Omit unchanged values so a PATCH merges against the server's latest definition. */
export function changedFlockForm(form: FormData, original: Flock): FormData {
    const result = new FormData();
    for (const [key, value] of form) {
        if (flockFields.includes(key as (typeof flockFields)[number])) {
            const before = original[key as (typeof flockFields)[number]];
            if (String(before ?? '') === value) continue;
        }
        result.append(key, value);
    }
    return result;
}
