import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, CustomerType } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

describe('Customer persistence', () => {
  const organizationIds: string[] = [];

  async function createOrganization(name: string) {
    const organization = await prisma.organization.create({
      data: {
        name,
        slug: `customer-test-${randomUUID()}`,
      },
    });

    organizationIds.push(organization.id);

    return organization;
  }

  afterEach(async () => {
    if (organizationIds.length === 0) {
      return;
    }

    await prisma.customer.deleteMany({
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

  it('persists an individual customer owned by an organization', async () => {
    const organization = await createOrganization('Individual Customer Test');

    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.INDIVIDUAL,
        name: 'John Brown',
        phone: '876-555-0100',
        email: 'john@example.com',
        address: 'Spanish Town, St. Catherine',
        notes: 'Test individual customer',
      },
      include: {
        organization: true,
      },
    });

    expect(customer.type).toBe(CustomerType.INDIVIDUAL);
    expect(customer.name).toBe('John Brown');
    expect(customer.organizationId).toBe(organization.id);
    expect(customer.organization.id).toBe(organization.id);
    expect(customer.isActive).toBe(true);
  });

  it('persists a business customer with a contact person', async () => {
    const organization = await createOrganization('Business Customer Test');

    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.BUSINESS,
        name: "Brown's Supermarket",
        contactPerson: 'John Brown',
        phone: '876-555-0200',
        email: 'accounts@brown.example.com',
      },
    });

    expect(customer.type).toBe(CustomerType.BUSINESS);
    expect(customer.name).toBe("Brown's Supermarket");
    expect(customer.contactPerson).toBe('John Brown');
  });

  it('prevents duplicate customer codes within the same organization', async () => {
    const organization = await createOrganization(
      'Customer Code Uniqueness Test',
    );

    await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.INDIVIDUAL,
        name: 'Customer One',
      },
    });

    await expect(
      prisma.customer.create({
        data: {
          organizationId: organization.id,
          code: 'CUS-000001',
          type: CustomerType.INDIVIDUAL,
          name: 'Customer Two',
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows the same customer code in different organizations', async () => {
    const organizationA = await createOrganization('Customer Organization A');
    const organizationB = await createOrganization('Customer Organization B');

    const customerA = await prisma.customer.create({
      data: {
        organizationId: organizationA.id,
        code: 'CUS-000001',
        type: CustomerType.INDIVIDUAL,
        name: 'Customer A',
      },
    });

    const customerB = await prisma.customer.create({
      data: {
        organizationId: organizationB.id,
        code: 'CUS-000001',
        type: CustomerType.BUSINESS,
        name: 'Customer B',
      },
    });

    expect(customerA.code).toBe(customerB.code);
    expect(customerA.organizationId).not.toBe(customerB.organizationId);
  });

  it('supports non-destructive customer deactivation', async () => {
    const organization = await createOrganization('Customer Lifecycle Test');

    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.INDIVIDUAL,
        name: 'Lifecycle Customer',
      },
    });

    const deactivated = await prisma.customer.update({
      where: {
        id: customer.id,
      },
      data: {
        isActive: false,
      },
    });

    expect(deactivated.id).toBe(customer.id);
    expect(deactivated.isActive).toBe(false);

    const persisted = await prisma.customer.findUnique({
      where: {
        id: customer.id,
      },
    });

    expect(persisted).not.toBeNull();
    expect(persisted?.isActive).toBe(false);
  });

  it('prevents deleting an organization that owns customers', async () => {
    const organization = await createOrganization(
      'Customer Delete Restriction Test',
    );

    await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.INDIVIDUAL,
        name: 'Protected Customer',
      },
    });

    await expect(
      prisma.organization.delete({
        where: {
          id: organization.id,
        },
      }),
    ).rejects.toBeDefined();
  });

  it('does not require a farm relationship to persist a customer', async () => {
    const organization = await createOrganization(
      'Organization-Level Customer Test',
    );

    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: 'CUS-000001',
        type: CustomerType.BUSINESS,
        name: 'Organization Customer',
      },
    });

    expect(customer.organizationId).toBe(organization.id);

    const farms = await prisma.farm.count({
      where: {
        organizationId: organization.id,
      },
    });

    expect(farms).toBe(0);
  });
});
