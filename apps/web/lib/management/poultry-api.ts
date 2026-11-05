import 'server-only';
import { z } from 'zod';
import type { MortalityEvent, FeedUsage, InventoryItem } from '@ancastle/types';
import { poultryHistoryQuerySchema } from '@ancastle/validation';
import type { ApplicationSearch } from '@/lib/application/selection';
import { managementApi, ManagementApiError, farmInventoryResponseSchema } from './api';
import { flockApiPath } from './flock-api';

const eventFields = {
    id: z.uuid(),
    farmId: z.uuid(),
    flockId: z.uuid(),
    actorUserId: z.uuid(),
    occurredAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
    note: z.string().nullable(),
    reference: z.string().nullable(),
};
const mortalitySchema = z.object({
    ...eventFields,
    deathCount: z.number().int().positive(),
    cause: z.string().nullable(),
    reversesEventId: z.uuid().nullable(),
}) satisfies z.ZodType<MortalityEvent>;
const feedUsageSchema = z.object({
    ...eventFields,
    inventoryItemId: z.uuid(),
    inventoryMovementId: z.uuid(),
    quantity: z.string(),
    reversesUsageId: z.uuid().nullable(),
}) satisfies z.ZodType<FeedUsage>;
const metaSchema = z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    totalItems: z.number().int().min(0),
    totalPages: z.number().int().min(0),
});
export const mortalityResponseSchema = z.object({ data: mortalitySchema });
export const feedUsageResponseSchema = z.object({ data: feedUsageSchema });
const mortalityListSchema = z.object({ data: z.array(mortalitySchema), meta: metaSchema });
const feedUsageListSchema = z.object({ data: z.array(feedUsageSchema), meta: metaSchema });

export type FeedChoice = Pick<InventoryItem, 'id' | 'code' | 'name' | 'unit'> & {
    stockOnHand: string;
    outOfStock: boolean;
};

export async function loadPoultryOperations(
    scope: { organization: string; farm: string },
    flockId: string,
    search: ApplicationSearch,
    inventoryRead: boolean,
) {
    const mortalityQuery = poultryHistoryQuerySchema.safeParse({
        page: search.mortalityPage,
        pageSize: search.historyPageSize,
    });
    const feedQuery = poultryHistoryQuerySchema.safeParse({
        page: search.feedPage,
        pageSize: search.historyPageSize,
    });
    if (!mortalityQuery.success || !feedQuery.success)
        throw new ManagementApiError('VALIDATION_ERROR');
    const queryString = (query: { page: number; pageSize: number }) =>
        new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    const base = `${flockApiPath(scope)}/${flockId}`;
    const [mortality, feed, stock] = await Promise.all([
        managementApi(`${base}/mortality?${queryString(mortalityQuery.data)}`, mortalityListSchema),
        managementApi(`${base}/feed-usage?${queryString(feedQuery.data)}`, feedUsageListSchema),
        inventoryRead
            ? managementApi(
                  `organizations/${scope.organization}/farms/${scope.farm}/inventory`,
                  farmInventoryResponseSchema,
              )
            : null,
    ]);
    // All items, including inactive feed items, retain readable historical identity.
    const items = new Map((stock?.data ?? []).map(({ item }) => [item.id, item]));
    const choices: FeedChoice[] = (stock?.data ?? [])
        .filter(({ item }) => item.category === 'FEED' && item.isActive)
        .map(({ item, stockOnHand, stockStatus }) => ({
            id: item.id,
            code: item.code,
            name: item.name,
            unit: item.unit,
            stockOnHand,
            outOfStock: stockStatus === 'OUT_OF_STOCK',
        }));
    return { mortality, feed, items, choices };
}
