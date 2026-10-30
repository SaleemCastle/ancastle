import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import { InventoryModule } from './inventory.module.js';

describe('Inventory item management API (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];

  const users = {
    admin: randomUUID(),
    staff: randomUUID(),
  };

  const userIds = Object.values(users);

  const membershipIds = {
    adminA: randomUUID(),
    adminB: randomUUID(),
    staffA: randomUUID(),
  };

  const items = {
    alpha: randomUUID(),
    foreign: randomUUID(),
  };

  const tokens: Record<string, string> = {};

  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'inventory-item-management-test-secret');

    await prisma.$connect();

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: 'Inventory Management A',
          slug: `inventory-management-${orgA}`,
        },
        {
          id: orgB,
          name: 'Inventory Management B',
          slug: `inventory-management-${orgB}`,
        },
      ],
    });

    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `${id}@example.com`,
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
          id: membershipIds.staffA,
          organizationId: orgA,
          userId: users.staff,
          role: 'STAFF',
        },
      ],
    });

    const module = await Test.createTestingModule({
      imports: [DatabaseModule, InventoryModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    const tokenService = module.get(TokenService);

    for (const id of userIds) {
      tokens[id] = await tokenService.createAccessToken(
        id,
        `${id}@example.com`,
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

    await prisma.inventoryItem.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.inventoryItem.createMany({
      data: [
        {
          id: items.alpha,
          organizationId: orgA,
          code: 'INV-000001',
          name: 'Layer Feed',
          description: 'Standard layer feed',
          unit: 'KG',
          category: 'FEED',
          lowStockThreshold: 25.125,
        },
        {
          id: items.foreign,
          organizationId: orgB,
          code: 'INV-000001',
          name: 'Foreign Feed',
          unit: 'KG',
          category: 'FEED',
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    await prisma.inventoryItem.deleteMany({
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

  const inventoryPath = (id?: string, organization: string = orgA) =>
    `/api/organizations/${organization}/inventory-items${id ? `/${id}` : ''}`;

  const auth = (user = users.admin) => `Bearer ${tokens[user]}`;

  it('creates, updates, deactivates, and reactivates an organization inventory item while keeping its server-generated code immutable', async () => {
    const created = await api()
      .post(inventoryPath())
      .set('Authorization', auth())
      .send({
        name: 'Vitamin Supplement',
        description: 'Poultry vitamin supplement',
        unit: 'L',
        category: 'VITAMIN',
        lowStockThreshold: 3.125,
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: 'INV-000002',
      name: 'Vitamin Supplement',
      description: 'Poultry vitamin supplement',
      unit: 'L',
      category: 'VITAMIN',
      lowStockThreshold: '3.125',
      isActive: true,
    });
    expect(created.body.data).not.toHaveProperty('organizationId');

    const id = created.body.data.id as string;
    const code = created.body.data.code as string;

    const codeMutation = await api()
      .patch(inventoryPath(id))
      .set('Authorization', auth())
      .send({
        code: 'INV-999999',
      });

    expect(codeMutation.status).toBe(400);
    expect(codeMutation.body.error.code).toBe('VALIDATION_ERROR');

    const updated = await api()
      .patch(inventoryPath(id))
      .set('Authorization', auth())
      .send({
        name: 'Updated Vitamin Supplement',
        lowStockThreshold: 4.375,
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id,
      code,
      name: 'Updated Vitamin Supplement',
      lowStockThreshold: '4.375',
    });

    const deactivated = await api()
      .post(`${inventoryPath(id)}/deactivate`)
      .set('Authorization', auth());

    expect(deactivated.status).toBe(201);
    expect(deactivated.body.data.isActive).toBe(false);

    const reactivated = await api()
      .post(`${inventoryPath(id)}/reactivate`)
      .set('Authorization', auth());

    expect(reactivated.status).toBe(201);
    expect(reactivated.body.data.isActive).toBe(true);

    const persisted = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
    });

    expect(persisted.organizationId).toBe(orgA);
    expect(persisted.code).toBe(code);
  });

  it('keeps inventory items isolated by organization and omits tenant ownership from responses', async () => {
    const list = await api().get(inventoryPath()).set('Authorization', auth());

    expect(list.status).toBe(200);

    expect(
      list.body.data.some((item: { id: string }) => item.id === items.foreign),
    ).toBe(false);

    for (const item of list.body.data) {
      expect(item).not.toHaveProperty('organizationId');
    }

    const foreign = await api()
      .get(inventoryPath(items.foreign))
      .set('Authorization', auth());

    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toEqual({
      code: 'INVENTORY_ITEM_NOT_FOUND',
      message: 'Inventory item was not found',
    });

    const before = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        id: items.foreign,
      },
    });

    const mutation = await api()
      .patch(inventoryPath(items.foreign))
      .set('Authorization', auth())
      .send({
        name: 'Cross Organization Mutation',
      });

    expect(mutation.status).toBe(404);

    const after = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        id: items.foreign,
      },
    });

    expect(after.name).toBe(before.name);
  });

  it('allows staff to read inventory items but denies item and lifecycle management', async () => {
    await api()
      .get(inventoryPath())
      .set('Authorization', auth(users.staff))
      .expect(200);

    await api()
      .get(inventoryPath(items.alpha))
      .set('Authorization', auth(users.staff))
      .expect(200);

    await api()
      .post(inventoryPath())
      .set('Authorization', auth(users.staff))
      .send({
        name: 'Forbidden Staff Item',
        unit: 'EACH',
        category: 'SUPPLY',
      })
      .expect(403);

    await api()
      .patch(inventoryPath(items.alpha))
      .set('Authorization', auth(users.staff))
      .send({
        name: 'Forbidden Staff Update',
      })
      .expect(403);

    await api()
      .post(`${inventoryPath(items.alpha)}/deactivate`)
      .set('Authorization', auth(users.staff))
      .expect(403);

    const unchanged = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        id: items.alpha,
      },
    });

    expect(unchanged.name).toBe('Layer Feed');
    expect(unchanged.isActive).toBe(true);
  });
});
