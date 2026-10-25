import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import type { OrganizationRole } from '@ancastle/types';
import { PrismaClient } from '../src/generated/prisma/client.js';

let client: PrismaClient | undefined;
function database() {
  if (!client) {
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for browser tests');
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }
  return client;
}

export async function createWebAuthFixture(
  options: { role?: OrganizationRole } = {},
) {
  const prisma = database();
  const id = randomUUID();
  const email = 'browser-' + id + '@example.com';
  const password = 'Browser-auth-test-input!';
  const organization = await prisma.organization.create({
    data: { name: 'Browser Test', slug: 'browser-test-' + id },
  });
  const ownedOrganizations = [organization.id];
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: options.role ?? 'OWNER',
    },
  });
  return {
    email,
    password,
    userId: user.id,
    organizationId: organization.id,
    async addOrganization(name: string, role: OrganizationRole = 'STAFF') {
      const created = await prisma.organization.create({
        data: {
          name,
          slug: 'browser-extra-' + randomUUID(),
          organizationMemberships: { create: { userId: user.id, role } },
        },
      });
      ownedOrganizations.push(created.id);
      return created.id;
    },
    async addFarm(
      name: string,
      code: string,
      settings: {
        organizationId?: string;
        assigned?: boolean;
        isActive?: boolean;
      } = {},
    ) {
      const organizationId = settings.organizationId ?? organization.id;
      if (!ownedOrganizations.includes(organizationId))
        throw new Error('Fixture organization is not owned by this test');
      const membership = await prisma.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: user.id } },
      });
      return prisma.$transaction(async (tx) => {
        const farm = await tx.farm.create({
          data: {
            organizationId,
            name,
            code,
            isActive: settings.isActive ?? true,
          },
        });
        if (settings.assigned !== false)
          await tx.farmAccessAssignment.create({
            data: {
              organizationId,
              membershipId: membership.id,
              farmId: farm.id,
            },
          });
        return farm;
      });
    },
    async setRole(role: OrganizationRole, organizationId = organization.id) {
      await prisma.organizationMembership.update({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        data: { role },
      });
    },
    async setMembershipActive(
      isActive: boolean,
      organizationId = organization.id,
    ) {
      await prisma.organizationMembership.update({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        data: { isActive },
      });
    },
    async setFarmAccess(farmId: string, isActive: boolean) {
      await prisma.farmAccessAssignment.updateMany({
        where: { farmId, membership: { userId: user.id } },
        data: { isActive },
      });
    },
    async setFarmActive(farmId: string, isActive: boolean) {
      await prisma.farm.updateMany({
        where: { id: farmId, organizationId: { in: ownedOrganizations } },
        data: { isActive },
      });
    },
    async deactivateUser() {
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
    },
    async revokeSessions() {
      await prisma.authSession.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });
    },
    async sessionCounts() {
      return {
        total: await prisma.authSession.count({ where: { userId: user.id } }),
        revoked: await prisma.authSession.count({
          where: { userId: user.id, revokedAt: { not: null } },
        }),
      };
    },
    async cleanup() {
      await prisma.authSession.deleteMany({ where: { userId: user.id } });
      await prisma.farmAccessAssignment.deleteMany({
        where: { organizationId: { in: ownedOrganizations } },
      });
      await prisma.farm.deleteMany({
        where: { organizationId: { in: ownedOrganizations } },
      });
      await prisma.organizationMembership.deleteMany({
        where: { organizationId: { in: ownedOrganizations }, userId: user.id },
      });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.organization.deleteMany({
        where: { id: { in: ownedOrganizations } },
      });
    },
  };
}
export async function closeWebAuthDatabase() {
  if (client) await client.$disconnect();
  client = undefined;
}
