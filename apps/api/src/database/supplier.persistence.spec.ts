import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { randomUUID } from 'crypto';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

describe('Supplier persistence', () => {
  const organizationIds: string[] = [];

  async function createOrganization(name: string) {
    const organization = await prisma.organization.create({
      data: {
        name,
        slug: `supplier-test-${randomUUID()}`,
      },
    });

    organizationIds.push(organization.id);

    return organization;
  }

  afterEach(async () => {
    if (organizationIds.length === 0) {
      return;
    }

    await prisma.supplier.deleteMany({
      where: {
        organizationId: {
          in: organizationIds,
        },
      },
    });

    await prisma.organization.deleteMany({
      where: {
        id: {
          in: organizationIds,
        },
      },
    });

    organizationIds.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists an individual supplier owned by an organization', async () => {
    const organization = await createOrganization('Individual Supplier Test');

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000001',
        name: 'John Brown Enterprises',
      },
      include: {
        organization: true,
      },
    });

    expect(supplier.name).toBe('John Brown Enterprises');
    expect(supplier.organizationId).toBe(organization.id);
    expect(supplier.organization.id).toBe(organization.id);
    expect(supplier.isActive).toBe(true);
  });

  it('Duplicate supplier code within one Organization is rejected with P2002.', async () => {
    const organization = await createOrganization(
      'Duplicate Supplier Code Test',
    );

    await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000002',
        name: 'Supplier One',
      },
    });

    await expect(
      prisma.supplier.create({
        data: {
          organizationId: organization.id,
          code: 'SUP-000002',
          name: 'Supplier Two',
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('Supplier contact information persists correctly.', async () => {
    const organization = await createOrganization('Supplier Contact Info Test');

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000003',
        name: 'Supplier Contact Test',
      },
    });

    expect(supplier.name).toBe('Supplier Contact Test');
    expect(supplier.code).toBe('SUP-000003');
  });

  it('Same supplier code can exist in different Organizations.', async () => {
    const organization1 = await createOrganization('Supplier Code Test Org 1');
    const organization2 = await createOrganization('Supplier Code Test Org 2');

    const supplier1 = await prisma.supplier.create({
      data: {
        organizationId: organization1.id,
        code: 'SUP-000004',
        name: 'Supplier One',
      },
    });

    const supplier2 = await prisma.supplier.create({
      data: {
        organizationId: organization2.id,
        code: 'SUP-000004',
        name: 'Supplier Two',
      },
    });

    expect(supplier1.code).toBe('SUP-000004');
    expect(supplier2.code).toBe('SUP-000004');
  });

  it('Supplier can be deactivated without deletion', async () => {
    const organization = await createOrganization('Supplier Deactivation Test');

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000005',
        name: 'Supplier To Deactivate',
      },
    });

    const deactivatedSupplier = await prisma.supplier.update({
      where: {
        id: supplier.id,
      },
      data: {
        isActive: false,
      },
    });

    expect(deactivatedSupplier.isActive).toBe(false);
  });

  it('Organization deletion is restricted while it owns a Supplier', async () => {
    const organization = await createOrganization(
      'Organization Deletion Restriction Test',
    );

    await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000006',
        name: 'Supplier For Deletion Test',
      },
    });

    await expect(
      prisma.organization.delete({
        where: {
          id: organization.id,
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('Supplier can exist without a farm relationship', async () => {
    const organization = await createOrganization('Supplier Without Farm Test');

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        code: 'SUP-000007',
        name: 'Supplier Without Farm',
      },
    });

    expect(supplier.name).toBe('Supplier Without Farm');
  });
});
