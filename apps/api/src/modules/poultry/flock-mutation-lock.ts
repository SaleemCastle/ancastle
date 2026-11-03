import { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

/** All flock mutations acquire the advisory lock before the row lock, then
 * read the authoritative definition and history within the same transaction.
 */
export async function lockFlockMutation(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  farmId: string,
  flockId: string,
) {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtext(${context.organizationId}), hashtext(${`flock:${farmId}:${flockId}`}))
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "flocks" WHERE "organizationId" = ${context.organizationId}::uuid
      AND "farmId" = ${farmId}::uuid AND "id" = ${flockId}::uuid FOR UPDATE
  `);
}
