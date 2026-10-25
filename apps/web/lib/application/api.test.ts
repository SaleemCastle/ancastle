import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadOrganizations } from './api';
import { AuthenticationRejectedError, AuthUnavailableError } from '../auth/errors';

const entry = {
    organization: { id: randomUUID(), name: 'Own organization', slug: 'own' },
    membership: { displayName: null, role: 'STAFF' },
    permissions: ['farm:read'],
    farms: [],
};
const result = (page: number, totalPages: number) =>
    new Response(
        JSON.stringify({
            data: [{ ...entry, privateValue: 'stripped' }],
            meta: { page, pageSize: 100, totalItems: totalPages, totalPages },
        }),
    );

describe('Application context adapter', () => {
    it('loads paginated fresh API context with a server bearer token and strips unknown fields', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(result(1, 2))
            .mockResolvedValueOnce(result(2, 2));
        expect(await loadOrganizations('test-access', fetcher)).toEqual([entry, entry]);
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            cache: 'no-store',
            redirect: 'error',
            headers: { Authorization: 'Bearer test-access' },
        });
        expect(String(fetcher.mock.calls[1][0])).toContain('page=2');
    });
    it('retries authentication only for 401, not authorization or network failures', async () => {
        await expect(
            loadOrganizations(
                'test',
                vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 })),
            ),
        ).rejects.toBeInstanceOf(AuthenticationRejectedError);
        for (const status of [403, 500])
            await expect(
                loadOrganizations(
                    'test',
                    vi
                        .fn<typeof fetch>()
                        .mockResolvedValue(new Response('private details', { status })),
                ),
            ).rejects.toBeInstanceOf(AuthUnavailableError);
        await expect(
            loadOrganizations(
                'test',
                vi.fn<typeof fetch>().mockRejectedValue(new Error('private')),
            ),
        ).rejects.toThrow('Authentication is temporarily unavailable');
    });
    it('rejects malformed and inconsistent pagination responses', async () => {
        for (const response of [new Response('private'), new Response('{}'), result(2, 2)])
            await expect(
                loadOrganizations('test', vi.fn<typeof fetch>().mockResolvedValue(response)),
            ).rejects.toBeInstanceOf(AuthUnavailableError);
    });
});
