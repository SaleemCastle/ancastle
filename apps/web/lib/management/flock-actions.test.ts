import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Flock } from '@ancastle/types';

const fake = vi.hoisted(() => ({ context: vi.fn(), api: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/headers', () => ({
    headers: async () => new Headers({ origin: 'https://farms.example.com' }),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: fake.revalidate }));
vi.mock('@/lib/application/current-context', () => ({ requireApplicationContext: fake.context }));
vi.mock('@/lib/management/api', async (original) => ({
    ...(await original<typeof import('./api')>()),
    managementApi: fake.api,
}));

import {
    createFlockAction,
    updateFlockAction,
    setFlockStatusAction,
    postMortalityAction,
    postFeedUsageAction,
} from '../../app/app/flocks/actions';
import { ManagementApiError } from './api';
import { ApplicationAccessDeniedError } from '../application/selection';
import { changedFlockForm, flockMetricsDate } from './flocks';
import { poultryPostingForm } from './poultry-form';

const organization = randomUUID();
const farm = randomUUID();
const flockId = randomUUID();
const path = `organizations/${organization}/farms/${farm}/flocks`;
function form(values: Record<string, string> = {}) {
    const result = new FormData();
    for (const [key, value] of Object.entries({ organization, farm, flockId, ...values }))
        result.set(key, value);
    return result;
}
const definition = {
    name: ' Layers ',
    birdType: '',
    placementDate: '2026-10-01',
    startingBirdCount: '100',
    expectedMaturityDate: '',
    notes: '',
};
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
    fake.context.mockResolvedValue({
        current: {
            organization: { id: organization },
            permissions: ['flock:read', 'flock:manage'],
        },
        farm: { id: farm },
    });
    fake.api.mockResolvedValue({ data: { id: flockId } });
});
afterEach(() => vi.unstubAllEnvs());

it('creates only allowed definition fields under verified farm context and revalidates', async () => {
    expect(
        await createFlockAction(
            {},
            form({
                ...definition,
                organizationId: randomUUID(),
                farmId: randomUUID(),
                code: 'INJECTED',
                isActive: 'false',
                metrics: '{}',
            }),
        ),
    ).toEqual({ success: 'Flock created.', resourceId: flockId });
    expect(fake.context).toHaveBeenLastCalledWith({ organization, farm });
    expect(fake.api).toHaveBeenCalledWith(path, expect.anything(), {
        method: 'POST',
        body: JSON.stringify({
            name: 'Layers',
            placementDate: '2026-10-01',
            startingBirdCount: 100,
        }),
    });
    expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
});

it('omits unchanged dates and sends a one-date PATCH for server-side merged-date validation', async () => {
    const original = {
        ...definition,
        name: 'Layers',
        birdType: null,
        startingBirdCount: 100,
        expectedMaturityDate: '2026-12-01',
        notes: null,
    } as Flock;
    const changed = changedFlockForm(
        form({
            ...definition,
            name: 'Layers',
            expectedMaturityDate: '2026-12-01',
            placementDate: '2026-10-02',
        }),
        original,
    );
    expect(changed.has('expectedMaturityDate')).toBe(false);
    expect(await updateFlockAction({}, changed)).toEqual({ success: 'Flock saved.' });
    expect(fake.api).toHaveBeenCalledWith(`${path}/${flockId}`, expect.anything(), {
        method: 'PATCH',
        body: JSON.stringify({ placementDate: '2026-10-02' }),
    });
    await updateFlockAction({}, form({ expectedMaturityDate: '' }));
    expect(fake.api).toHaveBeenLastCalledWith(`${path}/${flockId}`, expect.anything(), {
        method: 'PATCH',
        body: JSON.stringify({ expectedMaturityDate: null }),
    });
});

it('rejects invalid population and safely surfaces API over-mortality errors', async () => {
    const invalid = await createFlockAction({}, form({ ...definition, startingBirdCount: '1.5' }));
    expect(invalid.fields?.startingBirdCount).toBeDefined();
    expect(fake.api).not.toHaveBeenCalled();
    fake.api.mockRejectedValue(new ManagementApiError('FLOCK_OVER_MORTALITY'));
    expect(await updateFlockAction({}, form({ startingBirdCount: '2' }))).toEqual({
        error: 'Starting population cannot be less than recorded mortality.',
    });
    expect(fake.revalidate).not.toHaveBeenCalled();
});

it('uses explicit lifecycle endpoints with an empty payload', async () => {
    for (const operation of ['close', 'reactivate']) {
        const result = await setFlockStatusAction({}, form({ operation, isActive: 'false' }));
        expect(result.success).toBeDefined();
        expect(fake.api).toHaveBeenLastCalledWith(
            `${path}/${flockId}/${operation}`,
            expect.anything(),
            { method: 'POST', body: '{}' },
        );
    }
});

it('blocks mutations without manage permission or verified farm access', async () => {
    fake.context.mockResolvedValueOnce({
        current: { organization: { id: organization }, permissions: ['flock:read'] },
    });
    expect((await createFlockAction({}, form(definition))).error).toBeDefined();
    fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());
    expect((await createFlockAction({}, form(definition))).error).toBeDefined();
    fake.context.mockResolvedValueOnce({
        current: {
            organization: { id: organization },
            permissions: ['flock:read', 'flock:manage'],
        },
    });
    fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());
    expect((await createFlockAction({}, form(definition))).error).toBeDefined();
    expect(fake.api).not.toHaveBeenCalled();
});

it('resolves the UTC calendar date at the metrics request boundary', () => {
    expect(flockMetricsDate(new Date('2026-11-03T23:30:00-05:00'))).toBe('2026-11-04');
});

const posting = { occurredAt: '2026-11-03T14:30:00.000Z', note: ' Morning check ', reference: '' };
const feedItem = randomUUID();
function postingPermission(permission: string) {
    fake.context.mockResolvedValue({
        current: { organization: { id: organization }, permissions: ['flock:read', permission] },
        farm: { id: farm },
    });
}

it('posts mortality with its own permission, shared validation and no ownership/audit claims', async () => {
    postingPermission('flock:mortality-post');
    expect(
        await postMortalityAction(
            {},
            form({
                ...posting,
                deathCount: '2',
                cause: ' Unknown ',
                actorUserId: randomUUID(),
                farmId: randomUUID(),
                reversesEventId: randomUUID(),
            }),
        ),
    ).toEqual({ success: 'Mortality recorded.', resourceId: flockId });
    expect(fake.context).toHaveBeenLastCalledWith({ organization, farm });
    expect(fake.api).toHaveBeenCalledWith(`${path}/${flockId}/mortality`, expect.anything(), {
        method: 'POST',
        body: JSON.stringify({
            occurredAt: posting.occurredAt,
            note: 'Morning check',
            deathCount: 2,
            cause: 'Unknown',
        }),
    });
    expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
    fake.api.mockRejectedValueOnce(new ManagementApiError('FLOCK_OVER_MORTALITY'));
    expect(
        (await postMortalityAction({}, form({ ...posting, deathCount: '200', cause: '' }))).error,
    ).toMatch(/Death count exceeds/);
});

it('posts a precise positive feed quantity once and lets the API own the inventory issue', async () => {
    postingPermission('flock:feed-usage-post');
    const result = await postFeedUsageAction(
        {},
        form({
            ...posting,
            inventoryItemId: feedItem,
            quantity: '999999999999999.999',
            inventoryMovementId: randomUUID(),
            reason: 'ADJUSTMENT',
        }),
    );
    expect(result.success).toBe('Feed usage recorded.');
    expect(fake.api).toHaveBeenCalledTimes(1);
    expect(fake.api).toHaveBeenCalledWith(`${path}/${flockId}/feed-usage`, expect.anything(), {
        method: 'POST',
        body: JSON.stringify({
            occurredAt: posting.occurredAt,
            note: 'Morning check',
            inventoryItemId: feedItem,
            quantity: '999999999999999.999',
        }),
    });
    expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
    fake.api.mockRejectedValueOnce(new ManagementApiError('INSUFFICIENT_INVENTORY_STOCK'));
    expect(
        (
            await postFeedUsageAction(
                {},
                form({ ...posting, inventoryItemId: feedItem, quantity: '5' }),
            )
        ).error,
    ).toMatch(/not enough feed stock at this farm/);
});

it('rejects posting contract bypasses and malformed flock IDs before calling APIs', async () => {
    postingPermission('flock:mortality-post');
    expect(
        (await postMortalityAction({}, form({ ...posting, deathCount: '1.5', cause: '' }))).fields
            ?.deathCount,
    ).toBeDefined();
    expect(
        (
            await postMortalityAction(
                {},
                form({ ...posting, deathCount: '1', cause: '', occurredAt: '2026-11-03T14:30' }),
            )
        ).fields?.occurredAt,
    ).toBeDefined();
    postingPermission('flock:feed-usage-post');
    for (const quantity of ['-1', '0', '1.0001'])
        expect(
            (
                await postFeedUsageAction(
                    {},
                    form({ ...posting, inventoryItemId: feedItem, quantity }),
                )
            ).fields?.quantity,
        ).toBeDefined();
    expect(
        (
            await postFeedUsageAction(
                {},
                form({
                    ...posting,
                    inventoryItemId: feedItem,
                    quantity: '1',
                    flockId: '../foreign',
                }),
            )
        ).error,
    ).toBeDefined();
    expect(fake.api).not.toHaveBeenCalled();
});

it('rechecks the exact posting permission and selected farm, independently of manage access', async () => {
    const mortalityForm = () => form({ ...posting, deathCount: '1', cause: '' });
    expect((await postMortalityAction({}, mortalityForm())).error).toBeDefined(); // manage is not posting permission
    postingPermission('flock:mortality-post');
    fake.context.mockResolvedValueOnce({
        current: {
            organization: { id: organization },
            permissions: ['flock:read', 'flock:mortality-post'],
        },
    });
    fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());
    expect((await postMortalityAction({}, mortalityForm())).error).toBeDefined();
    postingPermission('flock:mortality-post');
    expect(
        (
            await postFeedUsageAction(
                {},
                form({ ...posting, inventoryItemId: feedItem, quantity: '1' }),
            )
        ).error,
    ).toBeDefined();
    expect(fake.api).not.toHaveBeenCalled();
});

it('converts browser-local occurrence time to an ISO instant before shared API validation', () => {
    const input = form({ occurredAt: '2026-11-03T09:30' });
    expect(poultryPostingForm(input).get('occurredAt')).toBe(
        new Date('2026-11-03T09:30').toISOString(),
    );
});
