import type {
  Flock,
  MortalityEvent,
  FeedUsage,
  FlockMetrics as FlockMetricsResponse,
} from '@ancastle/types';
import type {
  Flock as FlockRecord,
  MortalityEvent as MortalityRecord,
  FeedUsage as FeedRecord,
} from '../../generated/prisma/client.js';
import type { FlockMetrics } from './flock-metrics.js';

export function flockDetails(record: FlockRecord): Flock {
  return {
    id: record.id,
    farmId: record.farmId,
    code: record.code,
    name: record.name,
    birdType: record.birdType,
    placementDate: record.placementDate.toISOString().slice(0, 10),
    startingBirdCount: record.startingBirdCount,
    expectedMaturityDate:
      record.expectedMaturityDate?.toISOString().slice(0, 10) ?? null,
    notes: record.notes,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function metricDetails(metrics: FlockMetrics): FlockMetricsResponse {
  return {
    ...metrics,
    mortalityPercentage: metrics.mortalityPercentage.toString(),
    cumulativeFeedUsage: metrics.cumulativeFeedUsage.map((entry) => ({
      ...entry,
      quantity: entry.quantity.toString(),
    })),
  };
}

export function mortalityDetails(record: MortalityRecord): MortalityEvent {
  return {
    id: record.id,
    farmId: record.farmId,
    flockId: record.flockId,
    actorUserId: record.actorUserId,
    deathCount: record.deathCount,
    occurredAt: record.occurredAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    cause: record.cause,
    note: record.note,
    reference: record.reference,
    reversesEventId: record.reversesEventId,
  };
}

export function feedDetails(record: FeedRecord): FeedUsage {
  return {
    id: record.id,
    farmId: record.farmId,
    flockId: record.flockId,
    actorUserId: record.actorUserId,
    inventoryItemId: record.inventoryItemId,
    inventoryMovementId: record.inventoryMovementId,
    quantity: record.quantity.toString(),
    occurredAt: record.occurredAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    note: record.note,
    reference: record.reference,
    reversesUsageId: record.reversesUsageId,
  };
}
