import { randomUUID } from 'node:crypto';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { InventoryStockService } from './inventory-stock.service.js';

describe('Inventory stock service (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const service = new InventoryStockService(prisma);

  const organizationId = randomUUID();
  const farmId = randomUUID();
  const inventoryItemId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();

  const context = new OrganizationContext(
    organizationId,
    membershipId,
    userId,
    'ADMIN',
  );

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Inventory Stock Test',
        slug: 'inventory-stock-' + organizationId,
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email: userId + '@example.com',
        passwordHash: 'unused-test-hash',
      },
    });

    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId,
        userId,
        role: 'ADMIN',
      },
    });

    await prisma.farm.create({
      data: {
        id: farmId,
        organizationId,
        name: 'Stock Test Farm',
        code: 'STOCK-TEST',
      },
    });

    await prisma.inventoryItem.create({
      data: {
        id: inventoryItemId,
        organizationId,
        code: 'INV-STOCK',
        name: 'Stock Test Feed',
        unit: 'KG',
        category: 'FEED',
      },
    });
  });

  beforeEach(async () => {
    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId,
      },
    });
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId,
      },
    });

    await prisma.inventoryItem.deleteMany({
      where: {
        organizationId,
      },
    });

    await prisma.farm.deleteMany({
      where: {
        organizationId,
      },
    });

    await prisma.organizationMembership.deleteMany({
      where: {
        organizationId,
      },
    });

    await prisma.organization.delete({
      where: {
        id: organizationId,
      },
    });

    await prisma.user.delete({
      where: {
        id: userId,
      },
    });

    await prisma.$disconnect();
  });

  it('derives exact fractional stock from immutable movements', async () => {
    await prisma.inventoryMovement.createMany({
      data: [
        {
          organizationId,
          farmId,
          inventoryItemId,
          actorUserId: userId,
          quantity: '25.125',
          reason: 'RECEIPT',
          occurredAt: new Date(),
        },
        {
          organizationId,
          farmId,
          inventoryItemId,
          actorUserId: userId,
          quantity: '-4.375',
          reason: 'ISSUE',
          occurredAt: new Date(),
        },
      ],
    });

    const stock = await service.getStockOnHand(
      context,
      farmId,
      inventoryItemId,
    );

    expect(stock.toString()).toBe('20.75');
  });

  it('rejects a movement that would produce negative stock', async () => {
    await service.postMovement(context, {
      farmId,
      inventoryItemId,
      quantity: new Prisma.Decimal('5.000'),
      reason: 'RECEIPT',
      occurredAt: new Date(),
    });

    await expect(
      service.postMovement(context, {
        farmId,
        inventoryItemId,
        quantity: new Prisma.Decimal('-6.000'),
        reason: 'ISSUE',
        occurredAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_INVENTORY_STOCK',
    });

    const stock = await service.getStockOnHand(
      context,
      farmId,
      inventoryItemId,
    );

    expect(stock.toString()).toBe('5');
  });

  it('serializes concurrent outbound movements for the same stock position', async () => {
    await service.postMovement(context, {
      farmId,
      inventoryItemId,
      quantity: new Prisma.Decimal('10.000'),
      reason: 'RECEIPT',
      occurredAt: new Date(),
    });

    const results = await Promise.allSettled([
      service.postMovement(context, {
        farmId,
        inventoryItemId,
        quantity: new Prisma.Decimal('-8.000'),
        reason: 'ISSUE',
        occurredAt: new Date(),
      }),
      service.postMovement(context, {
        farmId,
        inventoryItemId,
        quantity: new Prisma.Decimal('-8.000'),
        reason: 'ISSUE',
        occurredAt: new Date(),
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);

    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);

    const stock = await service.getStockOnHand(
      context,
      farmId,
      inventoryItemId,
    );

    expect(stock.toString()).toBe('2');
  });
});
