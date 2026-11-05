import type { FlockWithMetrics, InventoryItem } from '@ancastle/types';
import { flockMaturityLabel } from '@/lib/management/flocks';

export function FlockStatus({ isActive }: { isActive: boolean }) {
    return (
        <span
            role="status"
            aria-label={`Status: ${isActive ? 'Active' : 'Closed'}`}
            className={
                isActive
                    ? 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800'
                    : 'inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
            }
        >
            {isActive ? 'Active' : 'Closed'}
        </span>
    );
}

export function FlockAge({ flock }: { flock: FlockWithMetrics }) {
    return (
        <div className="min-w-40">
            <p>
                {flock.metrics.ageDays} days ({flock.metrics.ageWeeks} weeks)
            </p>
            <p className="text-xs text-muted-foreground">{flockMaturityLabel(flock.metrics)}</p>
        </div>
    );
}

export function FlockDetails({
    flock,
    feedItems,
}: {
    flock: FlockWithMetrics;
    feedItems?: ReadonlyMap<string, InventoryItem>;
}) {
    const { metrics } = flock;
    const values = [
        ['Flock code', flock.code],
        ['Bird type', flock.birdType ?? 'Not provided'],
        ['Placement date', flock.placementDate],
        ['Expected maturity date', flock.expectedMaturityDate ?? 'Not provided'],
        ['Starting population', metrics.startingBirdCount],
        ['Live population', metrics.liveBirdCount],
        ['Cumulative mortality', metrics.cumulativeMortality],
        ['Mortality percentage', `${metrics.mortalityPercentage}%`],
        ['Age', `${metrics.ageDays} days (${metrics.ageWeeks} weeks)`],
        ['Maturity', flockMaturityLabel(metrics)],
    ];
    return (
        <section
            aria-label="Flock details"
            className="mt-6 space-y-5 rounded-xl border bg-card p-5"
        >
            <p className="text-sm text-muted-foreground">
                Age and maturity as of {metrics.ageAndMaturityAsOfDate} (UTC today). Population,
                mortality and feed totals include all current postings; they are not historical
                totals for that date.
            </p>
            <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {values.map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-sm font-medium">{label}</dt>
                        <dd className="mt-1 wrap-break-word text-sm text-muted-foreground">
                            {value}
                        </dd>
                    </div>
                ))}
            </dl>
            <div>
                <h2 className="text-sm font-medium">Cumulative feed usage</h2>
                {metrics.cumulativeFeedUsage.length ? (
                    <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                        {metrics.cumulativeFeedUsage.map((feed) => (
                            <li key={feed.inventoryItemId} className="wrap-break-word">
                                {feed.quantity} {feed.unit} ·{' '}
                                {feedItems?.get(feed.inventoryItemId)?.name ??
                                    'Feed item unavailable'}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-1 text-sm text-muted-foreground">No feed usage recorded.</p>
                )}
            </div>
            <div>
                <h2 className="text-sm font-medium">Notes</h2>
                <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">
                    {flock.notes ?? 'Not provided'}
                </p>
            </div>
        </section>
    );
}
