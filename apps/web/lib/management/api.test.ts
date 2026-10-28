import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { farmResponseSchema } from '@ancastle/validation';
import {
    fetchManagement,
    customerListResponseSchema,
    customerResponseSchema,
    supplierListResponseSchema,
    supplierResponseSchema,
} from './api';
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

    it('validates Customer DTOs and strips unexpected response fields', async () => {
        const customer = {
            id: randomUUID(),
            code: 'CUS-000001',
            type: 'BUSINESS' as const,
            name: 'Castle Produce Ltd',
            contactPerson: 'Jane Castle',
            phone: '876-555-0100',
            email: 'sales@example.com',
            address: 'Spanish Town',
            notes: null,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const detailFetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: {
                        ...customer,
                        organizationId: randomUUID(),
                        privateField: 'must-not-return',
                    },
                }),
            ),
        );

        expect(
            await fetchManagement(
                'organizations/example/customers/' + customer.id,
                customerResponseSchema,
                'test-access',
                {},
                detailFetcher,
            ),
        ).toEqual({
            data: customer,
        });

        const listFetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [customer],
                    meta: {
                        page: 1,
                        pageSize: 20,
                        totalItems: 1,
                        totalPages: 1,
                    },
                }),
            ),
        );

        expect(
            await fetchManagement(
                'organizations/example/customers',
                customerListResponseSchema,
                'test-access',
                {},
                listFetcher,
            ),
        ).toEqual({
            data: [customer],
            meta: {
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
            },
        });
    });

    it('validates supplier management responses', () => {
        const supplier = {
            id: 'supplier-1',
            code: 'SUP-000001',
            name: 'Ancastle Feed Supplies',
            contactPerson: 'Jane Brown',
            phone: '876-555-0100',
            email: 'sales@example.com',
            address: 'Spanish Town',
            notes: 'Primary feed supplier',
            isActive: true,
            createdAt: '2026-10-27T12:00:00.000Z',
            updatedAt: '2026-10-27T12:00:00.000Z',
        };

        expect(
            supplierResponseSchema.parse({
                data: supplier,
            }),
        ).toEqual({
            data: supplier,
        });

        expect(
            supplierListResponseSchema.parse({
                data: [supplier],
                meta: {
                    page: 1,
                    pageSize: 20,
                    totalItems: 1,
                    totalPages: 1,
                },
            }),
        ).toEqual({
            data: [supplier],
            meta: {
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
            },
        });
    });

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
