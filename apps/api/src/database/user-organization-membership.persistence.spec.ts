import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { MembershipRole, PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

describe('User and organization membership persistence', () => {
  let prisma: PrismaClient;
  let prismaConnected = false;

  const testId = randomUUID();
  const organizationSlug = `membership-test-${testId}`;
  const secondOrganizationSlug = `membership-test-second-${testId}`;
  const userEmail = `membership-${testId}@example.com`;

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

    await prisma.organizationMembership.deleteMany({
      where: {
        OR: [
          {
            organization: {
              slug: organizationSlug,
            },
          },
          {
            organization: {
              slug: secondOrganizationSlug,
            },
          },
          {
            user: {
              email: userEmail,
            },
          },
        ],
      },
    });

    await prisma.organization.deleteMany({
      where: {
        slug: {
          in: [organizationSlug, secondOrganizationSlug],
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: userEmail,
      },
    });

    await prisma.$disconnect();
  });

  it('persists a user and organization membership', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: 'Membership Test Organization',
        slug: organizationSlug,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: 'test-password-hash',
      },
    });

    const membership = await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: MembershipRole.ADMIN,
      },
      include: {
        organization: true,
        user: true,
      },
    });

    expect(membership.organization.id).toBe(organization.id);
    expect(membership.user.id).toBe(user.id);
    expect(membership.role).toBe(MembershipRole.ADMIN);
    expect(membership.isActive).toBe(true);
  });

  it('prevents duplicate user email identities', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: userEmail,
          passwordHash: 'another-test-password-hash',
        },
      }),
    ).rejects.toThrow();
  });

  it('prevents duplicate membership within the same organization', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: userEmail,
      },
    });

    await expect(
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: MembershipRole.STAFF,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows one user to belong to multiple organizations', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: userEmail,
      },
    });

    const secondOrganization = await prisma.organization.create({
      data: {
        name: 'Second Membership Test Organization',
        slug: secondOrganizationSlug,
      },
    });

    const membership = await prisma.organizationMembership.create({
      data: {
        organizationId: secondOrganization.id,
        userId: user.id,
        role: MembershipRole.MANAGER,
      },
    });

    expect(membership.userId).toBe(user.id);
    expect(membership.organizationId).toBe(secondOrganization.id);
    expect(membership.role).toBe(MembershipRole.MANAGER);
  });

  it('supports membership role changes', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: userEmail,
      },
    });

    const membership = await prisma.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      data: {
        role: MembershipRole.MANAGER,
      },
    });

    expect(membership.role).toBe(MembershipRole.MANAGER);
  });

  it('supports non-destructive membership deactivation', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: {
        slug: organizationSlug,
      },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: userEmail,
      },
    });

    const membership = await prisma.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      data: {
        isActive: false,
      },
    });

    expect(membership.isActive).toBe(false);

    const persistedMembership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
    });

    expect(persistedMembership).not.toBeNull();
    expect(persistedMembership?.isActive).toBe(false);
  });

  it('prevents deleting a user that still has memberships', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: userEmail,
      },
    });

    await expect(
      prisma.user.delete({
        where: {
          id: user.id,
        },
      }),
    ).rejects.toThrow();
  });
});
