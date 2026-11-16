import { createHash } from 'node:crypto';
import type {
  PostFulfilmentInput,
  ReverseFulfilmentInput,
} from '@ancastle/validation';
import { Prisma } from '../../generated/prisma/client.js';

export const fulfilmentHashVersion = 1;
export const canonicalId = (id: string) => id.toLowerCase();

/** Stable field order, normalized UUIDs/decimals/time and sorted allocations.
 * Absent optional text is encoded as null; validated text has already been trimmed.
 * Scope and actor are separately bound by the permanent command receipt.
 */
export function fulfilmentFingerprint(
  operation: 'POST' | 'REVERSE',
  targetId: string,
  input: PostFulfilmentInput | ReverseFulfilmentInput,
): string {
  const command = {
    version: fulfilmentHashVersion,
    operation,
    targetId: canonicalId(targetId),
    expectedOrderVersion: input.expectedOrderVersion,
    occurredAt: new Date(input.occurredAt).toISOString(),
    reference: input.reference ?? null,
    ...('allocations' in input
      ? {
          note: input.note ?? null,
          allocations: input.allocations
            .map((allocation) => ({
              orderLineId: canonicalId(allocation.orderLineId),
              kind: allocation.kind,
              sourceId: canonicalId(
                allocation.kind === 'POULTRY'
                  ? allocation.flockId
                  : allocation.inventoryItemId,
              ),
              quantity: new Prisma.Decimal(allocation.quantity).toFixed(),
            }))
            .sort((a, b) => {
              const left = `${a.orderLineId}:${a.kind}:${a.sourceId}`;
              const right = `${b.orderLineId}:${b.kind}:${b.sourceId}`;
              return left < right ? -1 : left > right ? 1 : 0;
            }),
        }
      : {
          reason: input.reason,
          postingErrorConfirmed: input.postingErrorConfirmed,
        }),
  };
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}
