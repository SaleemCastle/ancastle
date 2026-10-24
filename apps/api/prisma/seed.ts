import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: {
      slug: 'ancastle-farms',
    },
    update: {
      name: 'Ancastle Farms',
      isActive: true,
    },
    create: {
      name: 'Ancastle Farms',
      slug: 'ancastle-farms',
      isActive: true,
    },
  });

  const farm = await prisma.farm.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: 'MAIN',
      },
    },
    update: {
      name: 'Main Farm',
      isActive: true,
    },
    create: {
      organizationId: organization.id,
      name: 'Main Farm',
      code: 'MAIN',
      isActive: true,
    },
  });

  console.log(
    `Seeded organization "${organization.name}" with farm "${farm.name}".`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
