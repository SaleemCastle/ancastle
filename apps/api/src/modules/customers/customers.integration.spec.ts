import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TokenService } from '../auth/token.service.js';
import { CustomersModule } from './customers.module.js';

describe('Customer management API (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];

  const users = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
    crossRole: randomUUID(),
    outsider: randomUUID(),
  };

  const userIds = Object.values(users);

  const membershipIds = {
    adminA: randomUUID(),
    adminB: randomUUID(),
    managerA: randomUUID(),
    staffA: randomUUID(),
    crossRoleA: randomUUID(),
    crossRoleB: randomUUID(),
  };

  const customers = {
    alpha: randomUUID(),
    beta: randomUUID(),
    inactive: randomUUID(),
    foreign: randomUUID(),
  };

  const tokens: Record<string, string> = {};

  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'customer-management-test-secret');

    await prisma.$connect();

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: 'Customer Management A',
          slug: 'customer-management-' + orgA,
        },
        {
          id: orgB,
          name: 'Customer Management B',
          slug: 'customer-management-' + orgB,
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
        {
          id: membershipIds.managerA,
          organizationId: orgA,
          userId: users.manager,
          role: 'MANAGER',
        },
        {
          id: membershipIds.staffA,
          organizationId: orgA,
          userId: users.staff,
          role: 'STAFF',
        },
        {
          id: membershipIds.crossRoleA,
          organizationId: orgA,
          userId: users.crossRole,
          role: 'OWNER',
        },
        {
          id: membershipIds.crossRoleB,
          organizationId: orgB,
          userId: users.crossRole,
          role: 'STAFF',
        },
      ],
    });

    const module = await Test.createTestingModule({
      imports: [DatabaseModule, CustomersModule],
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

    await prisma.customer.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.customer.createMany({
      data: [
        {
          id: customers.alpha,
          organizationId: orgA,
          code: 'CUS-000001',
          type: 'BUSINESS',
          name: 'Alpha Farms',
          contactPerson: 'Alice Brown',
          phone: '876-555-1001',
          email: 'alice@alpha.example',
          address: 'Spanish Town',
          notes: 'Alpha notes',
        },
        {
          id: customers.beta,
          organizationId: orgA,
          code: 'CUS-000002',
          type: 'INDIVIDUAL',
          name: 'Beta Customer',
          contactPerson: 'Bob Green',
          phone: '876-555-1002',
          email: 'bob@beta.example',
        },
        {
          id: customers.inactive,
          organizationId: orgA,
          code: 'CUS-000003',
          type: 'BUSINESS',
          name: 'Inactive Customer',
          isActive: false,
        },
        {
          id: customers.foreign,
          organizationId: orgB,
          code: 'CUS-000001',
          type: 'BUSINESS',
          name: 'Foreign Customer',
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

    await prisma.customer.deleteMany({
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

  const customerPath = (id?: string, organization: string = orgA) =>
    `/api/organizations/${organization}/customers${id ? `/${id}` : ''}`;

  const auth = (user = users.admin) => 'Bearer ' + tokens[user];

  describe('authentication and organization context', () => {
    it('requires authentication', async () => {
      const response = await api().get(customerPath());

      expect(response.status).toBe(401);
    });

    it('rejects access when the user is not a member of the organization', async () => {
      const response = await api()
        .get(customerPath())
        .set('Authorization', auth(users.outsider));

      expect(response.status).toBe(403);
    });
  });

  describe('list customers', () => {
    it('returns only customers from the requested organization', async () => {
      const response = await api()
        .get(customerPath())
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
        response.body.data.map((customer: { id: string }) => customer.id),
      ).toEqual([customers.alpha, customers.beta, customers.inactive]);

      expect(
        response.body.data.some(
          (customer: { id: string }) => customer.id === customers.foreign,
        ),
      ).toBe(false);
    });

    it('paginates customers', async () => {
      const response = await api()
        .get(customerPath())
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
      expect(response.body.data[0].id).toBe(customers.inactive);
    });

    it('filters customers by active state', async () => {
      const response = await api()
        .get(customerPath())
        .query({
          isActive: 'false',
        })
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(customers.inactive);
    });

    it.each([
      ['code', '000002', customers.beta],
      ['name', 'alpha', customers.alpha],
      ['contact person', 'alice', customers.alpha],
      ['email', 'bob@beta', customers.beta],
      ['phone', '1001', customers.alpha],
    ])('searches customers by %s', async (_field, search, expectedId) => {
      const response = await api()
        .get(customerPath())
        .query({ search })
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(expectedId);
    });

    it('does not expose another organization customer through search', async () => {
      const response = await api()
        .get(customerPath())
        .query({ search: 'Foreign Customer' })
        .set('Authorization', auth());

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.meta.totalItems).toBe(0);
    });

    it('does not expose organization ownership', async () => {
      const response = await api()
        .get(customerPath())
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      for (const customer of response.body.data) {
        expect(customer).not.toHaveProperty('organizationId');
      }
    });
  });

  describe('create customer', () => {
    it('creates a customer using trusted organization ownership', async () => {
      const response = await api()
        .post(customerPath())
        .set('Authorization', auth())
        .send({
          type: 'BUSINESS',
          name: '  New Customer  ',
          contactPerson: '  Jane Doe  ',
          phone: ' 876-555-2000 ',
          email: '  JANE@EXAMPLE.COM ',
          address: '  Kingston  ',
          notes: '  New customer notes  ',
        });

      expect(response.status).toBe(201);

      expect(response.body.data).toMatchObject({
        code: 'CUS-000004',
        type: 'BUSINESS',
        name: 'New Customer',
        contactPerson: 'Jane Doe',
        phone: '876-555-2000',
        email: 'jane@example.com',
        address: 'Kingston',
        notes: 'New customer notes',
        isActive: true,
      });

      expect(response.body.data).not.toHaveProperty('organizationId');

      const persisted = await prisma.customer.findUniqueOrThrow({
        where: {
          id: response.body.data.id,
        },
      });

      expect(persisted.organizationId).toBe(orgA);
      expect(persisted.code).toBe('CUS-000004');
    });

    it('generates codes independently for each organization', async () => {
      const response = await api()
        .post(customerPath(undefined, orgB))
        .set('Authorization', auth())
        .send({
          type: 'INDIVIDUAL',
          name: 'Second Foreign Customer',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.code).toBe('CUS-000002');
    });

    it('rejects client-supplied organization ownership', async () => {
      const response = await api()
        .post(customerPath())
        .set('Authorization', auth())
        .send({
          type: 'BUSINESS',
          name: 'Spoof Attempt',
          organizationId: orgB,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');

      expect(
        await prisma.customer.count({
          where: {
            organizationId: orgB,
            name: 'Spoof Attempt',
          },
        }),
      ).toBe(0);
    });

    it('rejects client-supplied customer code', async () => {
      const response = await api()
        .post(customerPath())
        .set('Authorization', auth())
        .send({
          type: 'BUSINESS',
          name: 'Code Spoof',
          code: 'CUS-999999',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('get customer', () => {
    it('returns an organization customer', async () => {
      const response = await api()
        .get(customerPath(customers.alpha))
        .set('Authorization', auth());

      expect(response.status).toBe(200);

      expect(response.body.data).toMatchObject({
        id: customers.alpha,
        code: 'CUS-000001',
        type: 'BUSINESS',
        name: 'Alpha Farms',
      });

      expect(response.body.data).not.toHaveProperty('organizationId');
    });

    it('does not reveal whether a customer exists in another organization', async () => {
      const missingId = randomUUID();

      const foreign = await api()
        .get(customerPath(customers.foreign))
        .set('Authorization', auth());

      const missing = await api()
        .get(customerPath(missingId))
        .set('Authorization', auth());

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);

      expect(foreign.body.error).toEqual({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer was not found',
      });

      expect(foreign.body.error).toEqual(missing.body.error);
    });
  });

  describe('update customer', () => {
    it('partially updates a customer', async () => {
      const response = await api()
        .patch(customerPath(customers.alpha))
        .set('Authorization', auth())
        .send({
          name: 'Updated Alpha',
          email: ' UPDATED@EXAMPLE.COM ',
        });

      expect(response.status).toBe(200);

      expect(response.body.data).toMatchObject({
        id: customers.alpha,
        name: 'Updated Alpha',
        email: 'updated@example.com',

        // Omitted values remain unchanged.
        contactPerson: 'Alice Brown',
        phone: '876-555-1001',
      });
    });

    it('clears nullable fields with null', async () => {
      const response = await api()
        .patch(customerPath(customers.alpha))
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
        .patch(customerPath(customers.alpha))
        .set('Authorization', auth())
        .send({
          phone: '   ',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.phone).toBeNull();
    });

    it.each([
      ['organizationId', { organizationId: orgB }],
      ['code', { code: 'CUS-999999' }],
      ['isActive', { isActive: false }],
    ])('rejects updates to %s', async (_field, payload) => {
      const response = await api()
        .patch(customerPath(customers.alpha))
        .set('Authorization', auth())
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not mutate a customer in another organization', async () => {
      const before = await prisma.customer.findUniqueOrThrow({
        where: {
          id: customers.foreign,
        },
      });

      const response = await api()
        .patch(customerPath(customers.foreign))
        .set('Authorization', auth())
        .send({
          name: 'Cross Tenant Mutation',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer was not found',
      });

      const after = await prisma.customer.findUniqueOrThrow({
        where: {
          id: customers.foreign,
        },
      });

      expect(after.name).toBe(before.name);
    });
  });

  describe('customer lifecycle', () => {
    it('deactivates a customer', async () => {
      const response = await api()
        .post(customerPath(customers.alpha) + '/deactivate')
        .set('Authorization', auth());

      expect(response.status).toBe(201);
      expect(response.body.data.isActive).toBe(false);
    });

    it('deactivation is idempotent', async () => {
      const first = await api()
        .post(customerPath(customers.alpha) + '/deactivate')
        .set('Authorization', auth());

      const second = await api()
        .post(customerPath(customers.alpha) + '/deactivate')
        .set('Authorization', auth());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.isActive).toBe(false);
    });

    it('reactivates a customer', async () => {
      const response = await api()
        .post(customerPath(customers.inactive) + '/reactivate')
        .set('Authorization', auth());

      expect(response.status).toBe(201);
      expect(response.body.data.isActive).toBe(true);
    });

    it('reactivation is idempotent', async () => {
      const first = await api()
        .post(customerPath(customers.inactive) + '/reactivate')
        .set('Authorization', auth());

      const second = await api()
        .post(customerPath(customers.inactive) + '/reactivate')
        .set('Authorization', auth());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.isActive).toBe(true);
    });

    it.each(['deactivate', 'reactivate'] as const)(
      'does not allow %s across organizations',
      async (operation) => {
        const before = await prisma.customer.findUniqueOrThrow({
          where: {
            id: customers.foreign,
          },
        });

        const response = await api()
          .post(customerPath(customers.foreign) + '/' + operation)
          .set('Authorization', auth());

        expect(response.status).toBe(404);
        expect(response.body.error).toEqual({
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer was not found',
        });

        const after = await prisma.customer.findUniqueOrThrow({
          where: {
            id: customers.foreign,
          },
        });

        expect(after.isActive).toBe(before.isActive);
      },
    );

    describe('authorization', () => {
      it('allows managers to read, create, and update customers', async () => {
        await request(app.getHttpServer())
          .get(`/api/organizations/${orgA}/customers`)
          .set('Authorization', `Bearer ${tokens[users.manager]}`)
          .expect(200);

        const created = await request(app.getHttpServer())
          .post(`/api/organizations/${orgA}/customers`)
          .set('Authorization', `Bearer ${tokens[users.manager]}`)
          .send({
            type: 'BUSINESS',
            name: 'Manager Created Customer',
          })
          .expect(201);

        await request(app.getHttpServer())
          .patch(`/api/organizations/${orgA}/customers/${created.body.data.id}`)
          .set('Authorization', `Bearer ${tokens[users.manager]}`)
          .send({ name: 'Manager Updated Customer' })
          .expect(200);
      });

      it('forbids managers from changing customer lifecycle state', async () => {
        const response = await request(app.getHttpServer())
          .post(
            `/api/organizations/${orgA}/customers/${customers.alpha}/deactivate`,
          )
          .set('Authorization', `Bearer ${tokens[users.manager]}`)
          .expect(403);

        expect(response.body).toEqual({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action',
          },
        });

        const customer = await prisma.customer.findUnique({
          where: { id: customers.alpha },
        });

        expect(customer?.isActive).toBe(true);
      });

      it('allows staff to read customers but forbids writes', async () => {
        await request(app.getHttpServer())
          .get(`/api/organizations/${orgA}/customers`)
          .set('Authorization', `Bearer ${tokens[users.staff]}`)
          .expect(200);

        await request(app.getHttpServer())
          .post(`/api/organizations/${orgA}/customers`)
          .set('Authorization', `Bearer ${tokens[users.staff]}`)
          .send({
            type: 'BUSINESS',
            name: 'Forbidden Staff Customer',
          })
          .expect(403);

        await request(app.getHttpServer())
          .patch(`/api/organizations/${orgA}/customers/${customers.alpha}`)
          .set('Authorization', `Bearer ${tokens[users.staff]}`)
          .send({ name: 'Forbidden Staff Update' })
          .expect(403);

        await request(app.getHttpServer())
          .post(
            `/api/organizations/${orgA}/customers/${customers.alpha}/deactivate`,
          )
          .set('Authorization', `Bearer ${tokens[users.staff]}`)
          .expect(403);
      });

      it('uses the role from the selected organization instead of a stronger role in another organization', async () => {
        await request(app.getHttpServer())
          .post(`/api/organizations/${orgB}/customers`)
          .set('Authorization', `Bearer ${tokens[users.crossRole]}`)
          .send({
            type: 'BUSINESS',
            name: 'Cross Organization Escalation',
          })
          .expect(403);

        await request(app.getHttpServer())
          .get(`/api/organizations/${orgB}/customers`)
          .set('Authorization', `Bearer ${tokens[users.crossRole]}`)
          .expect(200);

        const leaked = await prisma.customer.findFirst({
          where: {
            organizationId: orgB,
            name: 'Cross Organization Escalation',
          },
        });

        expect(leaked).toBeNull();
      });
    });
  });

  describe('concurrent customer creation', () => {
    it('generates unique sequential codes for concurrent creates', async () => {
      await prisma.customer.deleteMany({
        where: {
          organizationId: orgA,
        },
      });

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          api()
            .post(customerPath())
            .set('Authorization', auth())
            .send({
              type: 'INDIVIDUAL',
              name: `Concurrent Customer ${index + 1}`,
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
        'CUS-000001',
        'CUS-000002',
        'CUS-000003',
        'CUS-000004',
        'CUS-000005',
      ]);

      expect(
        await prisma.customer.count({
          where: {
            organizationId: orgA,
          },
        }),
      ).toBe(5);
    });
  });
});
