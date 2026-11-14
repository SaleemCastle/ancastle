import type { Prisma } from '../../generated/prisma/client.js';
import { lockMutation } from '../../database/mutation-locks.js';
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
  await lockMutation(tx, context, { flocks: [{ farmId, flockId }] });
}
