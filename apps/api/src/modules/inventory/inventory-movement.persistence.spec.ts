import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service.js';

describe('Inventory movement persistence', () => {
  const prisma = new PrismaService();

  const orgA = randomUUID();
  const orgB = randomUUID();

  const farmA = randomUUID();
  const farmB = randomUUID();

  const itemA = randomUUID();
  const itemB = randomUUID();

  const actorUserId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: 'Inventory Ledger A',
          slug: 'inventory-ledger-' + orgA,
        },
        {
          id: orgB,
          name: 'Inventory Ledger B',
          slug: 'inventory-ledger-' + orgB,
        },
      ],
    });

    await prisma.user.create({
      data: {
        id: actorUserId,
        email: actorUserId + '@example.com',
        passwordHash: 'unused-test-hash',
      },
    });

    await prisma.farm.createMany({
      data: [
        {
          id: farmA,
          organizationId: orgA,
          name: 'Farm A',
          code: 'FARM-A',
        },
        {
          id: farmB,
          organizationId: orgB,
          name: 'Farm B',
          code: 'FARM-B',
        },
      ],
    });

    await prisma.inventoryItem.createMany({
      data: [
        {
          id: itemA,
          organizationId: orgA,
          code: 'INV-A',
          name: 'Broiler Feed',
          unit: 'KG',
          category: 'FEED',
        },
        {
          id: itemB,
          organizationId: orgB,
          code: 'INV-B',
          name: 'Layer Feed',
          unit: 'KG',
          category: 'FEED',
        },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId: {
          in: [orgA, orgB],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({
      where: {
        organizationId: {
          in: [orgA, orgB],
        },
      },
    });

    await prisma.inventoryItem.deleteMany({
      where: {
        organizationId: {
          in: [orgA, orgB],
        },
      },
    });

    await prisma.farm.deleteMany({
      where: {
        organizationId: {
          in: [orgA, orgB],
        },
      },
    });

    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [orgA, orgB],
        },
      },
    });

    await prisma.user.delete({
      where: {
        id: actorUserId,
      },
    });

    await prisma.$disconnect();
  });

  it('persists an exact fractional signed movement', async () => {
    const movement = await prisma.inventoryMovement.create({
      data: {
        organizationId: orgA,
        farmId: farmA,
        inventoryItemId: itemA,
        actorUserId,
        quantity: '25.125',
        reason: 'RECEIPT',
        occurredAt: new Date('2026-10-29T12:00:00.000Z'),
        note: 'Opening receipt',
        reference: 'OPEN-001',
      },
    });

    expect(movement.quantity.toString()).toBe('25.125');
    expect(movement.organizationId).toBe(orgA);
    expect(movement.farmId).toBe(farmA);
    expect(movement.inventoryItemId).toBe(itemA);
    expect(movement.actorUserId).toBe(actorUserId);
  });

  it('rejects cross-organization farm and inventory ownership', async () => {
    await expect(
      prisma.inventoryMovement.create({
        data: {
          organizationId: orgA,
          farmId: farmB,
          inventoryItemId: itemA,
          actorUserId,
          quantity: '5.000',
          reason: 'RECEIPT',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.inventoryMovement.create({
        data: {
          organizationId: orgA,
          farmId: farmA,
          inventoryItemId: itemB,
          actorUserId,
          quantity: '5.000',
          reason: 'RECEIPT',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a zero-quantity movement', async () => {
    await expect(
      prisma.inventoryMovement.create({
        data: {
          organizationId: orgA,
          farmId: farmA,
          inventoryItemId: itemA,
          actorUserId,
          quantity: '0.000',
          reason: 'ADJUSTMENT',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
