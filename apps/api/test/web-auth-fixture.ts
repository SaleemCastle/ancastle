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
    async addMember(
      options: {
        organizationId?: string;
        role?: OrganizationRole;
        displayName?: string | null;
        isActive?: boolean;
        userIsActive?: boolean;
        farmIds?: string[];
      } = {},
    ) {
      const organizationId = options.organizationId ?? organization.id;
      if (!ownedOrganizations.includes(organizationId))
        throw new Error('Fixture organization is not owned by this test');
      const memberId = randomUUID();
      const memberEmail = 'browser-member-' + memberId + '@example.com';
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: memberId,
            email: memberEmail,
            passwordHash,
            isActive: options.userIsActive ?? true,
          },
        });
        await tx.organizationMembership.create({
          data: {
            organizationId,
            userId: memberId,
            role: options.role ?? 'STAFF',
            displayName: options.displayName ?? null,
            isActive: options.isActive ?? true,
            farmAccessAssignments: {
              create: (options.farmIds ?? []).map((farmId) => ({ farmId })),
            },
          },
        });
      });
      return { id: memberId, email: memberEmail, password };
    },
    async attachMember(
      memberId: string,
      organizationId: string,
      role: OrganizationRole,
      displayName: string,
    ) {
      if (!ownedOrganizations.includes(organizationId))
        throw new Error('Fixture organization is not owned by this test');
      const owned = await prisma.organizationMembership.findFirst({
        where: { userId: memberId, organizationId: { in: ownedOrganizations } },
        select: { id: true },
      });
      if (!owned) throw new Error('Fixture member is not owned by this test');
      await prisma.organizationMembership.create({
        data: { organizationId, userId: memberId, role, displayName },
      });
    },
    async memberByEmail(memberEmail: string, organizationId = organization.id) {
      if (!ownedOrganizations.includes(organizationId))
        throw new Error('Fixture organization is not owned by this test');
      return prisma.organizationMembership.findFirst({
        where: { organizationId, user: { email: memberEmail } },
        select: {
          userId: true,
          displayName: true,
          role: true,
          isActive: true,
          user: { select: { email: true, isActive: true } },
          farmAccessAssignments: {
            where: { isActive: true },
            select: { farmId: true },
          },
        },
      });
    },
    async findFarm(code: string, organizationId = organization.id) {
      if (!ownedOrganizations.includes(organizationId))
        throw new Error('Fixture organization is not owned by this test');
      return prisma.farm.findUnique({
        where: { organizationId_code: { organizationId, code } },
        select: { id: true, name: true, code: true, isActive: true },
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
      // These unique organizations are created exclusively by this fixture. Bootstrap
      // only creates new identities; retain any identity with another membership.
      const members = await prisma.organizationMembership.findMany({
        where: { organizationId: { in: ownedOrganizations } },
        select: { userId: true },
      });
      const memberIds = [
        ...new Set([user.id, ...members.map((member) => member.userId)]),
      ];
      await prisma.authSession.deleteMany({
        where: { userId: { in: memberIds } },
      });
      await prisma.farmAccessAssignment.deleteMany({
        where: { organizationId: { in: ownedOrganizations } },
      });
      await prisma.farm.deleteMany({
        where: { organizationId: { in: ownedOrganizations } },
      });
      await prisma.organizationMembership.deleteMany({
        where: { organizationId: { in: ownedOrganizations } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: memberIds }, memberships: { none: {} } },
      });
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
