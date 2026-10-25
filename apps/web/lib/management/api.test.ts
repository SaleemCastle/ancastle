import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { farmResponseSchema } from '@ancastle/validation';
import { fetchManagement } from './api';
import { AuthenticationRejectedError, AuthUnavailableError } from '../auth/errors';

const data = {
    id: randomUUID(),
    organizationId: randomUUID(),
    name: 'Farm',
    code: 'FARM',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

describe('Management API transport', () => {
    it('uses fixed server API paths and token headers with no-store/redirect protection and safe DTOs', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: { ...data, passwordHash: 'private' } })),
            );
        expect(
            await fetchManagement(
                'organizations/' + data.organizationId + '/farms/' + data.id,
                farmResponseSchema,
                'test-access',
                { method: 'PATCH', body: '{"name":"Farm"}' },
                fetcher,
            ),
        ).toEqual({ data });
        expect(String(fetcher.mock.calls[0][0])).toContain(
            '/api/organizations/' + data.organizationId + '/farms/' + data.id,
        );
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            method: 'PATCH',
            cache: 'no-store',
            redirect: 'error',
            headers: { Authorization: 'Bearer test-access' },
        });
    });
    it.each(['FARM_CODE_EXISTS', 'FARM_NOT_FOUND', 'FORBIDDEN', 'VALIDATION_ERROR'])(
        'maps %s to a fixed safe UI error without upstream messages or fields',
        async (code) => {
            const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        error: {
                            code,
                            message: 'private upstream details',
                            fields: { password: ['private'] },
                        },
                    }),
                    { status: 400 },
                ),
            );
            await expect(
                fetchManagement('organizations/example', farmResponseSchema, 'test', {}, fetcher),
            ).rejects.toMatchObject({
                code,
                message: expect.not.stringContaining('private'),
            });
        },
    );
    it('distinguishes 401 for existing refresh coordination and sanitizes unexpected/invalid responses', async () => {
        await expect(
            fetchManagement(
                'path',
                farmResponseSchema,
                'test',
                {},
                vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 })),
            ),
        ).rejects.toBeInstanceOf(AuthenticationRejectedError);
        for (const response of [
            new Response('private'),
            new Response('{}'),
            new Response(JSON.stringify({ error: { code: '__proto__', message: 'private' } }), {
                status: 500,
            }),
        ])
            await expect(
                fetchManagement(
                    'path',
                    farmResponseSchema,
                    'test',
                    {},
                    vi.fn<typeof fetch>().mockResolvedValue(response),
                ),
            ).rejects.toBeInstanceOf(AuthUnavailableError);
        await expect(
            fetchManagement(
                'path',
                farmResponseSchema,
                'test',
                {},
                vi.fn<typeof fetch>().mockRejectedValue(new Error('private URL')),
            ),
        ).rejects.toThrow('Authentication is temporarily unavailable');
    });
});
