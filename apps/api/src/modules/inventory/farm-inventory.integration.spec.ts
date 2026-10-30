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

describe('Farm inventory API (HTTP + PostgreSQL)', () => {
  const prisma = new PrismaService();

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgIds = [orgA, orgB];

  const users = {
    admin: randomUUID(),
    staff: randomUUID(),
  };

  const userIds = Object.values(users);

  const memberships = {
    adminA: randomUUID(),
    adminB: randomUUID(),
    staffA: randomUUID(),
  };

  const farms = {
    first: randomUUID(),
    second: randomUUID(),
    foreign: randomUUID(),
  };

  const items = {
    feed: randomUUID(),
    foreign: randomUUID(),
  };

  const tokens: Record<string, string> = {};

  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'farm-inventory-test-secret');

    await prisma.$connect();

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: 'Farm Inventory A',
          slug: `farm-inventory-${orgA}`,
        },
        {
          id: orgB,
          name: 'Farm Inventory B',
          slug: `farm-inventory-${orgB}`,
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
          id: memberships.adminA,
          organizationId: orgA,
          userId: users.admin,
          role: 'ADMIN',
        },
        {
          id: memberships.adminB,
          organizationId: orgB,
          userId: users.admin,
          role: 'ADMIN',
        },
        {
          id: memberships.staffA,
          organizationId: orgA,
          userId: users.staff,
          role: 'STAFF',
        },
      ],
    });

    await prisma.farm.createMany({
      data: [
        {
          id: farms.first,
          organizationId: orgA,
          name: 'Farm One',
          code: '01',
        },
        {
          id: farms.second,
          organizationId: orgA,
          name: 'Farm Two',
          code: '02',
        },
        {
          id: farms.foreign,
          organizationId: orgB,
          name: 'Foreign Farm',
          code: '01',
        },
      ],
    });

    await prisma.farmAccessAssignment.create({
      data: {
        organizationId: orgA,
        membershipId: memberships.staffA,
        farmId: farms.first,
      },
    });

    await prisma.inventoryItem.createMany({
      data: [
        {
          id: items.feed,
          organizationId: orgA,
          code: 'INV-000001',
          name: 'Layer Feed',
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
    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

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

    await prisma.farm.updateMany({
      where: {
        id: {
          in: Object.values(farms),
        },
      },
      data: {
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.farmAccessAssignment.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.inventoryItem.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });

    await prisma.farm.deleteMany({
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

  const auth = (user = users.admin) => `Bearer ${tokens[user]}`;

  const path = (farmId = farms.first, organizationId = orgA) =>
    `/api/organizations/${organizationId}/farms/${farmId}/inventory`;

  it('posts movements and returns the exact derived farm balance', async () => {
    const receipt = await api()
      .post(`${path()}/movements`)
      .set('Authorization', auth())
      .send({
        inventoryItemId: items.feed,
        quantity: 50.125,
        reason: 'RECEIPT',
        occurredAt: '2026-10-30T10:00:00.000Z',
        note: 'Opening receipt',
        reference: 'REC-001',
      })
      .expect(201);

    expect(receipt.body.data).toMatchObject({
      farmId: farms.first,
      inventoryItemId: items.feed,
      quantity: '50.125',
      reason: 'RECEIPT',
      note: 'Opening receipt',
      reference: 'REC-001',
    });

    await api()
      .post(`${path()}/movements`)
      .set('Authorization', auth())
      .send({
        inventoryItemId: items.feed,
        quantity: -7.375,
        reason: 'ISSUE',
        occurredAt: '2026-10-30T11:00:00.000Z',
        note: 'Feed issued',
      })
      .expect(201);

    const stock = await api()
      .get(path())
      .set('Authorization', auth())
      .expect(200);

    const feed = stock.body.data.find(
      (entry: { item: { id: string } }) => entry.item.id === items.feed,
    );

    expect(feed).toMatchObject({
      stockOnHand: '42.75',
      item: {
        id: items.feed,
        code: 'INV-000001',
        name: 'Layer Feed',
      },
    });

    const history = await api()
      .get(`${path()}/movements`)
      .query({
        inventoryItemId: items.feed,
        page: 1,
        pageSize: 20,
      })
      .set('Authorization', auth())
      .expect(200);

    expect(history.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    });

    expect(
      history.body.data.map(
        (movement: { quantity: string; reason: string }) => ({
          quantity: movement.quantity,
          reason: movement.reason,
        }),
      ),
    ).toEqual([
      {
        quantity: '-7.375',
        reason: 'ISSUE',
      },
      {
        quantity: '50.125',
        reason: 'RECEIPT',
      },
    ]);
  });

  it('rejects a movement that would produce negative stock without persisting it', async () => {
    const response = await api()
      .post(`${path()}/movements`)
      .set('Authorization', auth())
      .send({
        inventoryItemId: items.feed,
        quantity: -1.125,
        reason: 'ISSUE',
        occurredAt: '2026-10-30T12:00:00.000Z',
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: 'INSUFFICIENT_INVENTORY_STOCK',
        message: 'Inventory movement would result in negative stock',
      },
    });

    expect(
      await prisma.inventoryMovement.count({
        where: {
          organizationId: orgA,
          farmId: farms.first,
          inventoryItemId: items.feed,
        },
      }),
    ).toBe(0);
  });

  it('enforces farm assignment and tenant isolation without exposing inventory data', async () => {
    await api()
      .get(path(farms.first))
      .set('Authorization', auth(users.staff))
      .expect(200);

    const unassigned = await api()
      .get(path(farms.second))
      .set('Authorization', auth(users.staff))
      .expect(403);

    const foreign = await api()
      .get(path(farms.foreign))
      .set('Authorization', auth(users.staff))
      .expect(403);

    const missing = await api()
      .get(path(randomUUID()))
      .set('Authorization', auth(users.staff))
      .expect(403);

    expect(unassigned.body).toEqual(missing.body);
    expect(foreign.body).toEqual(missing.body);

    expect(missing.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });

    await api()
      .post(`${path()}/movements`)
      .set('Authorization', auth())
      .send({
        inventoryItemId: items.foreign,
        quantity: 10.125,
        reason: 'RECEIPT',
        occurredAt: '2026-10-30T13:00:00.000Z',
      })
      .expect(400);

    expect(
      await prisma.inventoryMovement.count({
        where: {
          organizationId: {
            in: orgIds,
          },
        },
      }),
    ).toBe(0);
  });
});
