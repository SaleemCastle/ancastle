import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
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

export async function createWebAuthFixture() {
  const prisma = database();
  const id = randomUUID();
  const email = 'browser-' + id + '@example.com';
  const password = 'Browser-auth-test-input!';
  const organization = await prisma.organization.create({
    data: { name: 'Browser Test', slug: 'browser-test-' + id },
  });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
  });
  return {
    email,
    password,
    userId: user.id,
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
      await prisma.organizationMembership.deleteMany({
        where: { organizationId: organization.id, userId: user.id },
      });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    },
  };
}

export async function closeWebAuthDatabase() {
  if (client) await client.$disconnect();
  client = undefined;
}
