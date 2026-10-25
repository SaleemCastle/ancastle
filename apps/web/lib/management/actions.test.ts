import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    origin: 'https://farms.example.com' as string | null,
    context: vi.fn(),
    api: vi.fn(),
    revalidate: vi.fn(),
}));
vi.mock('next/headers', () => ({
    headers: async () => (fake.origin ? new Headers({ origin: fake.origin }) : new Headers()),
}));
vi.mock('next/navigation', () => ({
    unstable_rethrow: (error: unknown) => {
        if (error instanceof Error && error.message === 'redirect:/login') throw error;
    },
}));
vi.mock('next/cache', () => ({ revalidatePath: fake.revalidate }));
vi.mock('@/lib/application/current-context', () => ({ requireApplicationContext: fake.context }));
vi.mock('@/lib/management/api', async (original) => ({
    ...(await original<typeof import('./api')>()),
    managementApi: fake.api,
}));

import {
    createFarmAction,
    updateFarmAction,
    updateOrganizationAction,
    setFarmStatusAction,
} from '../../app/app/farms/actions';
import { ApplicationAccessDeniedError } from '../application/selection';
import { ManagementApiError } from './api';

const organization = randomUUID();
const farm = randomUUID();
function form(values: Record<string, string> = {}) {
    const result = new FormData();
    for (const [key, value] of Object.entries({
        organization,
        farmId: farm,
        name: ' Farm name ',
        code: 'lower_code',
        ...values,
    }))
        result.set(key, value);
    return result;
}

describe('Organization/farm server actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        fake.origin = 'https://farms.example.com';
        fake.context.mockResolvedValue({
            current: {
                organization: { id: organization },
                permissions: ['organization:update', 'farm:create', 'farm:update'],
            },
        });
        fake.api.mockResolvedValue({ data: { id: farm } });
    });
    afterEach(() => vi.unstubAllEnvs());
    it('normalizes shared contracts and derives mutation ownership from verified context', async () => {
        expect(
            await createFarmAction(
                {},
                form({ organizationId: randomUUID(), role: 'OWNER', userId: randomUUID() }),
            ),
        ).toEqual({ success: 'Farm created.', resourceId: farm });
        expect(fake.context).toHaveBeenCalledWith({ organization });
        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/farms',
            expect.anything(),
            { method: 'POST', body: JSON.stringify({ name: 'Farm name', code: 'LOWER_CODE' }) },
        );
        expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
    });
    it('updates only supported organization and farm profile fields', async () => {
        await updateOrganizationAction({}, form({ slug: 'injected', isActive: 'false' }));
        expect(fake.api.mock.calls[0][2]).toEqual({
            method: 'PATCH',
            body: JSON.stringify({ name: 'Farm name' }),
        });
        await updateFarmAction({}, form({ organizationId: randomUUID(), isActive: 'false' }));
        expect(fake.api.mock.calls[1][2]).toEqual({
            method: 'PATCH',
            body: JSON.stringify({ name: 'Farm name', code: 'LOWER_CODE' }),
        });
    });
    it('validates lifecycle booleans and sends no client ownership or role fields', async () => {
        expect(await setFarmStatusAction({}, form({ isActive: 'false', role: 'OWNER' }))).toEqual({
            success: 'Farm deactivated.',
        });
        expect(fake.api.mock.calls[0][2]).toEqual({ method: 'PATCH', body: '{"isActive":false}' });
        expect(
            (await setFarmStatusAction({}, form({ isActive: 'invalid' }))).fields?.isActive,
        ).toBeDefined();
        expect(fake.api).toHaveBeenCalledTimes(1);
    });
    it.each([null, 'https://attacker.invalid'])(
        'rejects missing/foreign origins before reading access or writing',
        async (origin) => {
            fake.origin = origin;
            expect((await createFarmAction({}, form())).error).toContain('could not be verified');
            expect(fake.context).not.toHaveBeenCalled();
            expect(fake.api).not.toHaveBeenCalled();
        },
    );
    it('rejects unauthenticated and unauthorized direct action calls and preserves login redirects', async () => {
        fake.context.mockRejectedValueOnce(new Error('redirect:/login'));
        await expect(createFarmAction({}, form())).rejects.toThrow('redirect:/login');
        fake.context.mockResolvedValueOnce({
            current: { permissions: ['farm:read'], organization: { id: organization } },
        });
        expect((await createFarmAction({}, form({ role: 'OWNER' }))).error).toContain(
            'do not have permission',
        );
        fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());
        expect(
            (await updateOrganizationAction({}, form({ organization: randomUUID() }))).error,
        ).toContain('do not have permission');
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('rejects malformed/duplicate IDs and invalid fields before issuing a mutation', async () => {
        expect((await createFarmAction({}, form({ organization: 'invalid' }))).error).toContain(
            'Check the form',
        );
        expect((await updateFarmAction({}, form({ farmId: '../foreign' }))).error).toContain(
            'Check the form',
        );
        expect(
            (await createFarmAction({}, form({ name: ' ', code: 'bad code' }))).fields,
        ).toHaveProperty('code');
        const duplicate = form();
        duplicate.append('organization', randomUUID());
        expect((await createFarmAction({}, duplicate)).error).toContain('Check the form');
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('returns safe backend business errors and sanitizes unexpected failures', async () => {
        fake.api.mockRejectedValueOnce(new ManagementApiError('FARM_CODE_EXISTS'));
        expect((await createFarmAction({}, form())).error).toContain('already exists');
        fake.api.mockRejectedValueOnce(new Error('private database details'));
        expect(await updateFarmAction({}, form())).toEqual({
            error: 'This service is temporarily unavailable. Please try again.',
        });
        expect(fake.revalidate).not.toHaveBeenCalled();
    });
    it('does not authorize a selected organization using stronger permissions in another organization', async () => {
        const other = randomUUID();
        fake.context.mockImplementation(async (selection: { organization: string }) => ({
            current: {
                organization: { id: selection.organization },
                permissions: selection.organization === organization ? ['farm:create'] : [],
            },
        }));
        expect(
            (await createFarmAction({}, form({ organization: other, role: 'OWNER' }))).error,
        ).toContain('do not have permission');
        expect(fake.api).not.toHaveBeenCalled();
    });
});
