import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { SuppliersModule } from './suppliers.module.js';

describe('Supplier management API (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];

  const users = {
    admin: randomUUID(),
    outsider: randomUUID(),
  };

  const userIds = Object.values(users);

  const membershipIds = {
    adminA: randomUUID(),
    adminB: randomUUID(),
  };

  const suppliers = {
    alpha: randomUUID(),
    beta: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };

  const tokens: Record<string, string> = {};

  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'supplier-management-test-secret');

    await prisma.$connect();

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: 'Supplier Management A',
          slug: 'supplier-management-' + orgA,
        },
        {
          id: orgB,
          name: 'Supplier Management B',
          slug: 'supplier-management-' + orgB,
        },
      ],
    });

    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: id + '@example.com',
        passwordHash: 'unused-test-hash',
      })),
    });

    await prisma.organizationMembership.createMany({
      data: [
        {
          id: membershipIds.adminA,
          organizationId: orgA,
          userId: users.admin,
          role: 'ADMIN',
        },
        {
          id: membershipIds.adminB,
          organizationId: orgB,
          userId: users.admin,
          role: 'ADMIN',
        },
      ],
    });

    const module = await Test.createTestingModule({
      imports: [DatabaseModule, SuppliersModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    const tokenService = module.get(TokenService);

    for (const id of userIds) {
      tokens[id] = await tokenService.createAccessToken(
        id,
        id + '@example.com',
      );
    }

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
  });

  beforeEach(async () => {
    await prisma.organization.updateMany({
      where: {
        id: {
          in: orgIds,
        },
      },
      data: {
        isActive: true,
      },
    });

    await prisma.user.updateMany({
      where: {
        id: {
          in: userIds,
        },
      },
      data: {
        isActive: true,
      },
    });

    await prisma.organizationMembership.updateMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
      data: {
        isActive: true,
      },
    });

    await prisma.supplier.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.supplier.createMany({
      data: [
        {
          id: suppliers.alpha,
          organizationId: orgA,
          code: 'SUP-000001',
          name: 'Alpha Suppliers',
          contactPerson: 'Alice Brown',
          phone: '876-555-1001',
          email: 'alice@alpha.example',
          address: 'Spanish Town',
          notes: 'Alpha notes',
        },
        {
          id: suppliers.beta,
          organizationId: orgA,
          code: 'SUP-000002',
          name: 'Beta Supplier',
          contactPerson: 'Bob Green',
          phone: '876-555-1002',
          email: 'bob@beta.example',
        },
        {
          id: suppliers.inactive,
          organizationId: orgA,
          code: 'SUP-000003',
          name: 'Inactive Supplier',
          isActive: false,
        },
        {
          id: suppliers.foreign,
          organizationId: orgB,
          code: 'SUP-000001',
          name: 'Foreign Supplier',
          contactPerson: 'Foreign Contact',
          email: 'foreign@example.com',
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    await prisma.supplier.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.organizationMembership.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });

    await prisma.organization.deleteMany({
      where: {
        id: {
          in: orgIds,
        },
      },
    });

    await prisma.$disconnect();

    vi.unstubAllEnvs();
  });

  const api = () => request(app.getHttpServer());

  const supplierPath = (id?: string, organization: string = orgA) =>
    `/api/organizations/${organization}/suppliers${id ? `/${id}` : ''}`;

  const auth = (user = users.admin) => 'Bearer ' + tokens[user];

  describe('authentication and organization context', () => {
    it('requires authentication', async () => {
      const response = await api().get(supplierPath());

      expect(response.status).toBe(401);
    });

    it('rejects access when the user is not a member of the organization', async () => {
      const response = await api()
        .get(supplierPath())
        .set('Authorization', auth(users.outsider));

      expect(response.status).toBe(403);
    });
  });

  describe('list suppliers', () => {
    it('returns only suppliers from the requested organization', async () => {
      const response = await api()
        .get(supplierPath())
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      expect(response.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 3,
        totalPages: 1,
      });

      expect(response.body.data).toHaveLength(3);

      expect(
        response.body.data.map((supplier: { id: string }) => supplier.id),
      ).toEqual([suppliers.alpha, suppliers.beta, suppliers.inactive]);

      expect(
        response.body.data.some(
          (supplier: { id: string }) => supplier.id === suppliers.foreign,
        ),
      ).toBe(false);
    });

    it('paginates suppliers', async () => {
      const response = await api()
        .get(supplierPath())
        .query({
          page: 2,
          pageSize: 2,
        })
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      expect(response.body.meta).toEqual({
        page: 2,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(suppliers.inactive);
    });

    it('filters suppliers by active state', async () => {
      const response = await api()
        .get(supplierPath())
        .query({
          isActive: 'false',
        })
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(suppliers.inactive);
    });

    it.each([
      ['code', '000002', suppliers.beta],
      ['name', 'alpha', suppliers.alpha],
      ['contact person', 'alice', suppliers.alpha],
      ['email', 'bob@beta', suppliers.beta],
      ['phone', '1001', suppliers.alpha],
    ])('searches suppliers by %s', async (_field, search, expectedId) => {
      const response = await api()
        .get(supplierPath())
        .query({ search })
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(expectedId);
    });

    it('does not expose organization ownership', async () => {
      const response = await api()
        .get(supplierPath())
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      for (const supplier of response.body.data) {
        expect(supplier).not.toHaveProperty('organizationId');
      }
    });
  });

  describe('create supplier', () => {
    it('creates a supplier using trusted organization ownership', async () => {
      const response = await api()
        .post(supplierPath())
        .set('Authorization', auth())
        .send({
          name: '  New Supplier  ',
          contactPerson: '  Jane Doe  ',
          phone: ' 876-555-2000 ',
          email: '  JANE@EXAMPLE.COM ',
          address: '  Kingston  ',
          notes: '  New supplier notes  ',
        });

      expect(response.status).toBe(201);

      expect(response.body.data).toMatchObject({
        code: 'SUP-000004',
        name: 'New Supplier',
        contactPerson: 'Jane Doe',
        phone: '876-555-2000',
        email: 'jane@example.com',
        address: 'Kingston',
        notes: 'New supplier notes',
        isActive: true,
      });

      expect(response.body.data).not.toHaveProperty('organizationId');

      const persisted = await prisma.supplier.findUniqueOrThrow({
        where: {
          id: response.body.data.id,
        },
      });

      expect(persisted.organizationId).toBe(orgA);
      expect(persisted.code).toBe('SUP-000004');
    });

    it('generates codes independently for each organization', async () => {
      const response = await api()
        .post(supplierPath(undefined, orgB))
        .set('Authorization', auth())
        .send({
          name: 'Second Foreign Supplier',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.code).toBe('SUP-000002');
    });

    it('rejects client-supplied organization ownership', async () => {
      const response = await api()
        .post(supplierPath())
        .set('Authorization', auth())
        .send({
          name: 'Spoof Attempt',
          organizationId: orgB,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');

      expect(
        await prisma.supplier.count({
          where: {
            organizationId: orgB,
            name: 'Spoof Attempt',
          },
        }),
      ).toBe(0);
    });

    it('rejects client-supplied supplier code', async () => {
      const response = await api()
        .post(supplierPath())
        .set('Authorization', auth())
        .send({
          name: 'Code Spoof',
          code: 'SUP-999999',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('get supplier', () => {
    it('returns an organization supplier', async () => {
      const response = await api()
        .get(supplierPath(suppliers.alpha))
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      expect(response.body.data).toMatchObject({
        id: suppliers.alpha,
        code: 'SUP-000001',
        name: 'Alpha Suppliers',
      });

      expect(response.body.data).not.toHaveProperty('organizationId');
    });

    it('does not reveal whether a supplier exists in another organization', async () => {
      const missingId = randomUUID();

      const foreign = await api()
        .get(supplierPath(suppliers.foreign))
        .set('Authorization', auth());

      const missing = await api()
        .get(supplierPath(missingId))
        .set('Authorization', auth());

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);

      expect(foreign.body.error).toEqual({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier was not found',
      });

      expect(foreign.body.error).toEqual(missing.body.error);
    });
  });

  describe('update supplier', () => {
    it('partially updates a supplier', async () => {
      const response = await api()
        .patch(supplierPath(suppliers.alpha))
        .set('Authorization', auth())
        .send({
          name: 'Updated Alpha',
          email: ' UPDATED@EXAMPLE.COM ',
        });

      expect(response.status).toBe(200);

      expect(response.body.data).toMatchObject({
        id: suppliers.alpha,
        name: 'Updated Alpha',
        email: 'updated@example.com',

        // Omitted values remain unchanged.
        contactPerson: 'Alice Brown',
        phone: '876-555-1001',
      });
    });

    it('clears nullable fields with null', async () => {
      const response = await api()
        .patch(supplierPath(suppliers.alpha))
        .set('Authorization', auth())
        .send({
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
        });

      expect(response.status).toBe(200);

      expect(response.body.data).toMatchObject({
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
      });
    });

    it('normalizes blank nullable fields to null', async () => {
      const response = await api()
        .patch(supplierPath(suppliers.alpha))
        .set('Authorization', auth())
        .send({
          phone: '   ',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.phone).toBeNull();
    });

    it.each([
      ['organizationId', { organizationId: orgB }],
      ['code', { code: 'SUP-999999' }],
      ['isActive', { isActive: false }],
    ])('rejects updates to %s', async (_field, payload) => {
      const response = await api()
        .patch(supplierPath(suppliers.alpha))
        .set('Authorization', auth())
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not mutate a supplier in another organization', async () => {
      const before = await prisma.supplier.findUniqueOrThrow({
        where: {
          id: suppliers.foreign,
        },
      });

      const response = await api()
        .patch(supplierPath(suppliers.foreign))
        .set('Authorization', auth())
        .send({
          name: 'Cross Tenant Mutation',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier was not found',
      });

      const after = await prisma.supplier.findUniqueOrThrow({
        where: {
          id: suppliers.foreign,
        },
      });

      expect(after.name).toBe(before.name);
    });
  });

  describe('supplier lifecycle', () => {
    it('deactivates a supplier', async () => {
      const response = await api()
        .post(supplierPath(suppliers.alpha) + '/deactivate')
        .set('Authorization', auth());

      expect(response.status).toBe(201);
      expect(response.body.data.isActive).toBe(false);
    });

    it('deactivation is idempotent', async () => {
      const first = await api()
        .post(supplierPath(suppliers.alpha) + '/deactivate')
        .set('Authorization', auth());

      const second = await api()
        .post(supplierPath(suppliers.alpha) + '/deactivate')
        .set('Authorization', auth());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.isActive).toBe(false);
    });

    it('reactivates a supplier', async () => {
      const response = await api()
        .post(supplierPath(suppliers.inactive) + '/reactivate')
        .set('Authorization', auth());

      expect(response.status).toBe(201);
      expect(response.body.data.isActive).toBe(true);
    });

    it('reactivation is idempotent', async () => {
      const first = await api()
        .post(supplierPath(suppliers.inactive) + '/reactivate')
        .set('Authorization', auth());

      const second = await api()
        .post(supplierPath(suppliers.inactive) + '/reactivate')
        .set('Authorization', auth());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.isActive).toBe(true);
    });

    it.each(['deactivate', 'reactivate'] as const)(
      'does not allow %s across organizations',
      async (operation) => {
        const before = await prisma.supplier.findUniqueOrThrow({
          where: {
            id: suppliers.foreign,
          },
        });

        const response = await api()
          .post(supplierPath(suppliers.foreign) + '/' + operation)
          .set('Authorization', auth());

        expect(response.status).toBe(404);
        expect(response.body.error).toEqual({
          code: 'SUPPLIER_NOT_FOUND',
          message: 'Supplier was not found',
        });

        const after = await prisma.supplier.findUniqueOrThrow({
          where: {
            id: suppliers.foreign,
          },
        });

        expect(after.isActive).toBe(before.isActive);
      },
    );
  });

  describe('concurrent supplier creation', () => {
    it('generates unique sequential codes for concurrent creates', async () => {
      await prisma.supplier.deleteMany({
        where: {
          organizationId: orgA,
        },
      });

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          api()
            .post(supplierPath())
            .set('Authorization', auth())
            .send({
              name: `Concurrent Supplier ${index + 1}`,
            }),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      const codes = responses.map(
        (response) => response.body.data.code as string,
      );

      expect(new Set(codes).size).toBe(5);

      expect([...codes].sort()).toEqual([
        'SUP-000001',
        'SUP-000002',
        'SUP-000003',
        'SUP-000004',
        'SUP-000005',
      ]);

      expect(
        await prisma.supplier.count({
          where: {
            organizationId: orgA,
          },
        }),
      ).toBe(5);
    });
  });
});
