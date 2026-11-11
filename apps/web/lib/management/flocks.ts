import type { Flock, FlockMetrics, FlockMaturityState } from '@ancastle/types';

/** UI/API boundary convention: today is the current UTC calendar date. */
export function flockMetricsDate(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

// Display labels describe expected-date states, not confirmed biological maturity.
// The API's daysToMaturity is the countdown; no dates or metrics are recomputed here.
export const flockMaturityLabels: Record<FlockMaturityState, string> = {
    BEFORE_EXPECTED_MATURITY: 'Not yet mature',
    AT_OR_PAST_EXPECTED_MATURITY: 'Expected maturity reached',
    NO_EXPECTED_MATURITY_DATE: 'No expected maturity date',
};
export const flockMaturityExplanation =
    'Not yet mature means the expected maturity date is still ahead. ' +
    'Expected maturity reached means that date has arrived or passed. ' +
    'These states are based on the expected maturity date, not confirmed biological maturity, ' +
    'and are independent of whether a flock is active or closed.';

export function flockMaturityLabel(metrics: FlockMetrics): string {
    return flockMaturityLabels[metrics.maturityState];
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
