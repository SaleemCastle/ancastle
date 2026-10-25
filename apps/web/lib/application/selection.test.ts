import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApplicationOrganization } from '@ancastle/types';
import {
    applicationHref,
    ApplicationAccessDeniedError,
    selectApplicationContext,
} from './selection';

const first = randomUUID();
const second = randomUUID();
const farmA = { id: randomUUID(), name: 'Farm A', code: 'A' };
const farmB = { id: randomUUID(), name: 'Farm B', code: 'B' };
const organization = (id: string, farms: (typeof farmA)[]): ApplicationOrganization => ({
    organization: { id, name: id, slug: id },
    membership: { role: 'STAFF', displayName: null },
    permissions: ['farm:read'],
    farms,
});

describe('Application context selection', () => {
    it('selects a single organization/farm automatically and supports no memberships/farms', () => {
        expect(selectApplicationContext([organization(first, [farmA])], {}).farm).toEqual(farmA);
        expect(selectApplicationContext([organization(first, [])], {}).farm).toBeNull();
        expect(selectApplicationContext([], {})).toEqual({ current: null, farm: null });
    });
    it('keeps multiple farms unselected until the user chooses and preserves explicit choices', () => {
        const organizations = [organization(first, [farmA, farmB])];
        expect(selectApplicationContext(organizations, {}).farm).toBeNull();
        expect(
            selectApplicationContext(organizations, { organization: first, farm: farmB.id }).farm,
        ).toEqual(farmB);
    });
    it.each([
        { organization: second },
        { organization: first, farm: randomUUID() },
        { organization: first, farm: farmB.id },
        { farm: farmA.id },
        { organization: 'invalid' },
        { organization: [first, second] },
        { organization: first, farm: ['invalid'] },
    ])('rejects forged, foreign, malformed and ambiguous selections: %j', (search) => {
        expect(() =>
            selectApplicationContext(
                [organization(first, [farmA]), organization(second, [farmB])].filter(
                    (entry) => entry.organization.id === first,
                ),
                search,
            ),
        ).toThrow(ApplicationAccessDeniedError);
    });
    it('keeps organization roles separate and never authorizes a farm in another membership', () => {
        const admin = {
            ...organization(first, [farmA]),
            membership: { role: 'ADMIN' as const, displayName: 'A name' },
            permissions: ['farm:access-all'],
        };
        const staff = organization(second, [farmB]);
        const result = selectApplicationContext([admin, staff], { organization: second });
        expect(result.current?.membership.role).toBe('STAFF');
        expect(result.current?.permissions).not.toContain('farm:access-all');
        expect(() =>
            selectApplicationContext([admin, staff], { organization: second, farm: farmA.id }),
        ).toThrow(ApplicationAccessDeniedError);
        expect(() =>
            selectApplicationContext([organization(first, [])], {
                organization: first,
                farm: farmA.id,
            }),
        ).toThrow(ApplicationAccessDeniedError);
    });
    it('preserves selection in navigation URLs without treating extra payload claims as authority', () => {
        expect(applicationHref('/app/dashboard', first, farmA.id)).toBe(
            '/app/dashboard?organization=' + first + '&farm=' + farmA.id,
        );
        expect(
            selectApplicationContext([organization(first, [farmA])], {
                role: 'OWNER',
                userId: randomUUID(),
            }).current?.membership.role,
        ).toBe('STAFF');
    });
});
