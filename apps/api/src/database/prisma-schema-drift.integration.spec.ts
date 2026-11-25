import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { temporaryDatabase } from '../test/temporary-database.js';

describe('Prisma migration/schema drift (isolated PostgreSQL)', () => {
  it('detects no drift and keeps datasource and shadow databases isolated', async () => {
    const datasource = await temporaryDatabase();
    const shadow = await temporaryDatabase({ applyMigrations: false });
    const configPath = resolve(
      process.cwd(),
      `prisma.audit.${randomUUID()}.config.ts`,
    );
    try {
      const datasourceName = new URL(datasource.connectionString).pathname;
      const shadowName = new URL(shadow.connectionString).pathname;
      expect(datasourceName).not.toBe(shadowName);

      await writeFile(
        configPath,
        `import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';
dotenv.config({ path: '../../.env' });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
`,
        'utf8',
      );

      const prismaCli = resolve(
        process.cwd(),
        'node_modules/prisma/build/index.js',
      );
      const result = spawnSync(
        process.execPath,
        [
          prismaCli,
          'migrate',
          'diff',
          '--config',
          configPath,
          '--from-migrations',
          'prisma/migrations',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 120_000,
          env: {
            ...process.env,
            DATABASE_URL: datasource.connectionString,
            SHADOW_DATABASE_URL: shadow.connectionString,
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'No difference detected',
      );

      const expectedIndexes = new Set([
        'invoices_organizationId_dueAt_id_idx',
        'invoices_organizationId_customerId_dueAt_id_idx',
        'payment_allocations_organizationId_customerId_createdAt_id_idx',
      ]);
      const indexes = await datasource.prisma.$queryRaw<
        { indexname: string }[]
      >`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'invoices_organizationId_dueAt_id_idx',
            'invoices_organizationId_customerId_dueAt_id_idx',
            'payment_allocations_organizationId_customerId_createdAt_id_idx'
          )
      `;
      expect(new Set(indexes.map(({ indexname }) => indexname))).toEqual(
        expectedIndexes,
      );
    } finally {
      await rm(configPath, { force: true });
      await shadow.dispose();
      await datasource.dispose();
    }
  }, 120_000);
});
