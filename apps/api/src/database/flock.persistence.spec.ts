import { randomUUID } from 'node:crypto';

import { PrismaService } from './prisma.service.js';
import { FarmContext } from '../modules/authorization/farm-context.js';

describe('Flock persistence', () => {
  const prisma = new PrismaService();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const farmA = randomUUID();
  const farmA2 = randomUUID();
  const farmB = randomUUID();
  const organizationIds = [orgA, orgB];
  const placementDate = new Date('2026-11-01T00:00:00.000Z');

  function flockData() {
    return {
      organizationId: orgA,
      farmId: farmA,
      code: 'FLK-000001',
      name: 'November placement',
      placementDate,
      startingBirdCount: 100,
    };
  }

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.createMany({
      data: organizationIds.map((id) => ({
        id,
        name: 'Flock persistence organization',
        slug: `flock-persistence-${id}`,
      })),
    });
    await prisma.farm.createMany({
      data: [
        { id: farmA, organizationId: orgA, name: 'North', code: 'NORTH' },
        { id: farmA2, organizationId: orgA, name: 'South', code: 'SOUTH' },
        { id: farmB, organizationId: orgB, name: 'North', code: 'NORTH' },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.flock.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
  });

  afterAll(async () => {
    await prisma.flock.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.farm.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.$disconnect();
  });

  it('persists placement details, generated UUID and default active lifecycle', async () => {
    const expectedMaturityDate = new Date('2026-12-13T00:00:00.000Z');
    const flock = await prisma.flock.create({
      data: {
        ...flockData(),
        birdType: 'Broiler chicken',
        expectedMaturityDate,
        notes: 'Initial placement',
      },
    });

    expect(flock).toMatchObject({
      ...flockData(),
      birdType: 'Broiler chicken',
      expectedMaturityDate,
      notes: 'Initial placement',
      isActive: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(flock.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('keeps codes unique across farms in an organization but allows reuse in another tenant', async () => {
    await prisma.flock.create({ data: flockData() });
    await expect(
      prisma.flock.create({ data: { ...flockData(), farmId: farmA2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const other = await prisma.flock.create({
      data: { ...flockData(), organizationId: orgB, farmId: farmB },
    });
    expect(other.code).toBe('FLK-000001');
  });

  it('rejects cross-organization and missing farm ownership on creation and update', async () => {
    for (const farmId of [farmB, randomUUID()]) {
      await expect(
        prisma.flock.create({ data: { ...flockData(), farmId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }

    const flock = await prisma.flock.create({ data: flockData() });
    await expect(
      prisma.flock.update({
        where: { id: flock.id },
        data: { farmId: farmB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.flock.update({
        where: { id: flock.id },
        data: { organizationId: orgB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.farm.update({
        where: { id: farmA },
        data: { organizationId: orgB, code: 'MOVED-NORTH' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it.each([0, -1])(
    'rejects a starting population of %i at the database boundary',
    async (startingBirdCount) => {
      await expect(
        prisma.flock.create({ data: { ...flockData(), startingBirdCount } }),
      ).rejects.toThrow();
    },
  );

  it('stores bird counts as database integers and rejects fractional integer input', async () => {
    const flock = await prisma.flock.create({ data: flockData() });
    // Test PostgreSQL input directly: Prisma Int serialization truncates JS fractions.
    // Strict request-level integer validation belongs to the shared-contract card.
    await expect(
      prisma.$executeRaw`
        UPDATE "flocks" SET "startingBirdCount" = '1.5'
        WHERE "id" = ${flock.id}::uuid
          AND "organizationId" = ${orgA}::uuid
          AND "farmId" = ${farmA}::uuid
      `,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '22P02' } },
      },
    });
  });

  it('allows unspecified or same-day maturity but rejects maturity before placement', async () => {
    const flock = await prisma.flock.create({ data: flockData() });
    expect(flock.expectedMaturityDate).toBeNull();
    await prisma.flock.update({
      where: { id: flock.id },
      data: { expectedMaturityDate: placementDate },
    });
    await expect(
      prisma.flock.update({
        where: { id: flock.id },
        data: { expectedMaturityDate: new Date('2026-10-31T00:00:00.000Z') },
      }),
    ).rejects.toThrow();
  });

  it('closes and reactivates without losing identity or placement population', async () => {
    const flock = await prisma.flock.create({ data: flockData() });
    const context = new FarmContext(orgA, farmA);
    const [closed] = await prisma.flock.updateManyAndReturn({
      where: context.scope({ id: flock.id }),
      data: { isActive: false },
    });
    expect(closed).toMatchObject({
      id: flock.id,
      code: flock.code,
      startingBirdCount: 100,
      isActive: false,
      createdAt: flock.createdAt,
    });
    expect(closed.updatedAt.getTime()).toBeGreaterThanOrEqual(
      flock.updatedAt.getTime(),
    );
    const [reactivated] = await prisma.flock.updateManyAndReturn({
      where: context.scope({ id: flock.id }),
      data: { isActive: true },
    });
    expect(reactivated).toMatchObject({ id: flock.id, isActive: true });
  });

  it('supports existing farm context scoping without exposing another farm or tenant', async () => {
    const flock = await prisma.flock.create({ data: flockData() });
    await prisma.flock.create({
      data: { ...flockData(), farmId: farmA2, code: 'FLK-000002' },
    });
    await prisma.flock.create({
      data: { ...flockData(), organizationId: orgB, farmId: farmB },
    });
    const context = new FarmContext(orgA, farmA);
    expect(await prisma.flock.findMany({ where: context.scope({}) })).toEqual([
      flock,
    ]);
    expect(
      await prisma.flock.findMany({
        where: context.scope({ organizationId: orgB, farmId: farmB }),
      }),
    ).toEqual([]);
  });

  it('restricts deleting the owning farm and organization while a flock exists', async () => {
    await prisma.flock.create({ data: flockData() });
    await expect(
      prisma.farm.delete({ where: { id: farmA } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.organization.delete({ where: { id: orgA } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
