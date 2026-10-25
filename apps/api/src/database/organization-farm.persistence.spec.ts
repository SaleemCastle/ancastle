import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;

describe('Organization and Farm persistence', () => {
  let prisma: PrismaClient;
  let prismaConnected = false;

  const organizationSlug = `test-org-${randomUUID()}`;

  beforeAll(async () => {

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined');
    }

    const adapter = new PrismaPg({
      connectionString,
    });

    prisma = new PrismaClient({ adapter });

    await prisma.$connect();
    prismaConnected = true;
  });

  afterAll(async () => {
    if (!prismaConnected) {
      return;
    }

    await prisma.farm.deleteMany({
      where: {
        organization: {
          slug: organizationSlug,
        },
      },
    });

    await prisma.organization.deleteMany({
      where: {
        slug: {
          in: [organizationSlug, `${organizationSlug}-second`],
        },
      },
    });

    await prisma.$disconnect();
  });

  it('persists an organization with multiple farms', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: 'Persistence Test Organization',
        slug: organizationSlug,
        farms: {
          create: [
            {
              name: 'North Farm',
              code: 'NORTH',
            },
            {
              name: 'South Farm',
              code: 'SOUTH',
            },
          ],
        },
      },
      include: {
        farms: true,
      },
    });

    expect(organization.farms).toHaveLength(2);

    expect(organization.farms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'North Farm',
          code: 'NORTH',
          isActive: true,
        }),
        expect.objectContaining({
          name: 'South Farm',
          code: 'SOUTH',
          isActive: true,
        }),
      ]),
    );
  });

  it('enforces organization slug uniqueness', async () => {
    await expect(
      prisma.organization.create({
        data: {
          name: 'Duplicate Organization',
          slug: organizationSlug,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces farm code uniqueness within an organization', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    await expect(
      prisma.farm.create({
        data: {
          organizationId: organization.id,
          name: 'Duplicate North Farm',
          code: 'NORTH',
        },
      }),
    ).rejects.toThrow();
  });

  it('allows the same farm code in different organizations', async () => {
    const secondOrganization = await prisma.organization.create({
      data: {
        name: 'Second Persistence Organization',
        slug: `${organizationSlug}-second`,
      },
    });

    const farm = await prisma.farm.create({
      data: {
        organizationId: secondOrganization.id,
        name: 'North Farm',
        code: 'NORTH',
      },
    });

    expect(farm.code).toBe('NORTH');

    await prisma.farm.delete({
      where: {
        id: farm.id,
      },
    });

    await prisma.organization.delete({
      where: {
        id: secondOrganization.id,
      },
    });
  });

  it('supports non-destructive deactivation', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    const farm = await prisma.farm.findUniqueOrThrow({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: 'NORTH',
        },
      },
    });

    const deactivatedFarm = await prisma.farm.update({
      where: {
        id: farm.id,
      },
      data: {
        isActive: false,
      },
    });

    expect(deactivatedFarm.isActive).toBe(false);

    const persistedFarm = await prisma.farm.findUnique({
      where: {
        id: farm.id,
      },
    });

    expect(persistedFarm).not.toBeNull();
    expect(persistedFarm?.isActive).toBe(false);
  });

  it('prevents deleting an organization that still owns farms', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    await expect(
      prisma.organization.delete({
        where: {
          id: organization.id,
        },
      }),
    ).rejects.toThrow();
  });
});
