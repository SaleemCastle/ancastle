import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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
    createUserAction,
    updateMemberProfileAction,
    updateMemberRoleAction,
    setMemberStatusAction,
    replaceMemberFarmsAction,
} from '../../app/app/users/actions';
import { ManagementApiError } from './api';
import { ApplicationAccessDeniedError } from '../application/selection';
import { organizationMemberResponseSchema } from '@ancastle/validation';

const organization = randomUUID();
const userId = randomUUID();
const farm = randomUUID();
const password = 'Test-only-bootstrap-input!';
function form(values: Record<string, string> = {}) {
    const result = new FormData();
    for (const [name, value] of Object.entries({
        organization,
        userId,
        email: ' New@Example.com ',
        password,
        displayName: ' Member Name ',
        role: 'STAFF',
        ...values,
    }))
        result.set(name, value);
    return result;
}

describe('Organization user administration actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('WEB_APP_URL', 'https://farms.example.com');
        fake.origin = 'https://farms.example.com';
        fake.context.mockResolvedValue({
            current: {
                organization: { id: organization },
                permissions: ['user:create', 'user:update', 'user:deactivate', 'membership:manage'],
            },
        });
        fake.api.mockResolvedValue({
            data: { userId, passwordHash: 'must-not-return', refreshToken: 'must-not-return' },
        });
    });
    afterEach(() => vi.unstubAllEnvs());
    it('bootstraps a new identity with validated input and never returns credentials or token fields', async () => {
        const input = form({ organizationId: randomUUID(), permissions: 'all' });
        input.append('farmIds', farm);
        const result = await createUserAction({}, input);
        expect(result).toEqual({ success: 'User created.', resourceId: userId });
        expect(JSON.stringify(result)).not.toContain(password);
        expect(JSON.stringify(result)).not.toContain('must-not-return');
        expect(fake.api).toHaveBeenCalledWith(
            'organizations/' + organization + '/users',
            expect.anything(),
            {
                method: 'POST',
                body: JSON.stringify({
                    email: 'new@example.com',
                    password,
                    displayName: 'Member Name',
                    role: 'STAFF',
                    farmIds: [farm],
                }),
            },
        );
        expect(fake.revalidate).toHaveBeenCalledWith('/app', 'layout');
    });
    it('keeps existing global identity fields out of profile/role/status mutations', async () => {
        await updateMemberProfileAction(
            {},
            form({ email: 'injected@example.com', password: 'injected', isActive: 'false' }),
        );
        expect(fake.api.mock.calls[0][2]).toEqual({
            method: 'PATCH',
            body: '{"displayName":"Member Name"}',
        });
        await updateMemberRoleAction(
            {},
            form({ role: 'MANAGER', isActive: 'false', password: 'injected' }),
        );
        expect(fake.api.mock.calls[1][2]).toEqual({ method: 'PATCH', body: '{"role":"MANAGER"}' });
        await setMemberStatusAction({}, form({ isActive: 'false' }));
        expect(fake.api.mock.calls[2][2]).toEqual({ method: 'PATCH', body: '{"isActive":false}' });
        await updateMemberProfileAction({}, form({ displayName: '' }));
        expect(fake.api.mock.calls[3][2]).toEqual({
            method: 'PATCH',
            body: '{"displayName":null}',
        });
    });
    it('supports multiple, one and zero explicit grants and rejects duplicate/malformed IDs', async () => {
        const input = form();
        input.append('farmIds', farm);
        input.append('farmIds', randomUUID());
        await replaceMemberFarmsAction({}, input);
        expect(JSON.parse(fake.api.mock.calls[0][2].body).farmIds).toHaveLength(2);
        await replaceMemberFarmsAction({}, form());
        expect(fake.api.mock.calls[1][2]).toEqual({ method: 'PUT', body: '{"farmIds":[]}' });
        input.append('farmIds', farm);
        expect((await replaceMemberFarmsAction({}, input)).fields?.farmIds).toBeDefined();
        expect((await updateMemberRoleAction({}, form({ userId: '../foreign' }))).error).toContain(
            'Check the form',
        );
        expect(fake.api).toHaveBeenCalledTimes(2);
    });
    it.each([
        { permissions: ['user:create'] },
        { permissions: ['membership:manage'] },
        { permissions: ['user:read'] },
    ])(
        'requires both bootstrap permissions, not client role claims: %j',
        async ({ permissions }) => {
            fake.context.mockResolvedValue({
                current: { organization: { id: organization }, permissions },
            });
            expect((await createUserAction({}, form({ role: 'OWNER' }))).error).toContain(
                'do not have permission',
            );
            expect(fake.api).not.toHaveBeenCalled();
        },
    );
    it('requires status permission in addition to membership administration', async () => {
        fake.context.mockResolvedValueOnce({
            current: { organization: { id: organization }, permissions: ['membership:manage'] },
        });
        expect((await setMemberStatusAction({}, form({ isActive: 'false' }))).error).toContain(
            'do not have permission',
        );
        expect(fake.api).not.toHaveBeenCalled();
    });
    it('validates roles, status and bootstrap passwords without echoing submitted values', async () => {
        expect(
            (await updateMemberRoleAction({}, form({ role: 'ROOT' }))).fields?.role,
        ).toBeDefined();
        expect(
            (await setMemberStatusAction({}, form({ isActive: 'invalid' }))).fields?.isActive,
        ).toBeDefined();
        const result = await createUserAction({}, form({ password: 'short' }));
        expect(result.fields?.password).toBeDefined();
        expect(JSON.stringify(result)).not.toContain('short');
        expect(fake.api).not.toHaveBeenCalled();
    });
    it.each([null, 'https://attacker.invalid'])(
        'rejects CSRF before reading context or writing',
        async (origin) => {
            fake.origin = origin;
            expect((await createUserAction({}, form())).error).toContain('could not be verified');
            expect(fake.context).not.toHaveBeenCalled();
            expect(fake.api).not.toHaveBeenCalled();
        },
    );
    it('rejects unauthenticated, revoked and foreign organization access before mutations', async () => {
        fake.context.mockRejectedValueOnce(new Error('redirect:/login'));
        await expect(updateMemberRoleAction({}, form())).rejects.toThrow('redirect:/login');
        fake.context.mockRejectedValueOnce(new ApplicationAccessDeniedError());
        expect(
            (await replaceMemberFarmsAction({}, form({ organization: randomUUID() }))).error,
        ).toContain('do not have permission');
        expect(fake.api).not.toHaveBeenCalled();
    });
    it.each([
        'LAST_ADMINISTRATOR',
        'USER_CREATION_CONFLICT',
        'INVALID_FARM_ACCESS',
        'CONCURRENT_UPDATE',
        'ORGANIZATION_USER_NOT_FOUND',
    ])('maps %s to a safe business error', async (code) => {
        fake.api.mockRejectedValueOnce(new ManagementApiError(code));
        const result = await updateMemberRoleAction({}, form());
        expect(result.error).toBeTruthy();
        expect(result).not.toHaveProperty('password');
        expect(fake.revalidate).not.toHaveBeenCalled();
    });
    it('strips sensitive unexpected identity fields from shared response contracts', () => {
        const parsed = organizationMemberResponseSchema.parse({
            data: {
                membershipId: randomUUID(),
                organizationId: organization,
                userId,
                email: 'member@example.com',
                userIsActive: true,
                displayName: null,
                role: 'STAFF',
                isActive: true,
                farmAccess: { allFarms: false, farmIds: [] },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                passwordHash: 'private',
                password,
                tokens: ['private'],
            },
        });
        expect(JSON.stringify(parsed)).not.toContain('private');
        expect(JSON.stringify(parsed)).not.toContain(password);
    });
});
