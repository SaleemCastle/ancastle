import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaService } from '../database/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Real commits/concurrency without deleting append-only fixtures or disabling
 * triggers. Only the randomly named database owned by this helper is removed.
 */
export async function temporaryDatabase() {
  const admin = new PrismaService();
  const databaseName = `poultry_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  let prisma: PrismaService | undefined;
  const dispose = async () => {
    await prisma?.$disconnect();
    try {
      if (created && /^poultry_test_[a-f0-9]{32}$/.test(databaseName)) {
        await admin.$executeRawUnsafe(
          `DROP DATABASE "${databaseName}" WITH (FORCE)`,
        );
      }
    } finally {
      await admin.$disconnect();
    }
  };
  try {
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    const setup = await new PrismaPg({
      connectionString: url.toString(),
    }).connect();
    try {
      const migrations = new URL('../../prisma/migrations/', import.meta.url);
      for (const entry of (
        await readdir(migrations, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) {
          // The pg simple-query protocol preserves PL/pgSQL dollar-quoted bodies.
          await setup
            .underlyingDriver()
            .query(
              await readFile(
                new URL(`${entry.name}/migration.sql`, migrations),
                'utf8',
              ),
            );
        }
      }
    } finally {
      await setup.dispose();
    }
    // PrismaService adds lifecycle hooks only; domain operations use this same
    // client interface against the isolated database, just as in the feed suite.
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }),
    }) as PrismaService;
    await prisma.$connect();
    return { prisma, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
