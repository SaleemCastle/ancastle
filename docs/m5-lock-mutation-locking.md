# M5-LOCK mutation locking and inventory definitions

This implements the canonical protocol in the [approved M5-01 ADR](m5-01-sales-fulfilment-architecture.md)
for existing M3/M4 writers. M5-03 persistence must already be deployed. No new
Prisma schema or migration is required, and no sales or population-v2 writer is
enabled.

## Lock plan and transaction ownership

`apps/api/src/database/mutation-locks.ts` acquires one complete server-created
plan in the following order, skipping unused stages:

| Stage | Protocol                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Organization FOR KEY SHARE, or FOR UPDATE upfront for code allocation                                                                                                                    |
| 1     | Scoped fulfilment command advisory identity, when a future writer supplies it                                                                                                            |
| 2     | Scoped Order FOR UPDATE, when a future writer supplies it                                                                                                                                |
| 3     | Farm, Customer, SalesProduct, PoultryProductSource, InventoryItem in fixed table order; canonical ascending UUID within each; FOR SHARE readers or upfront FOR UPDATE definition writers |
| 4     | Distinct farm/flock UUID order: existing flock advisory key, then scoped flock row FOR UPDATE                                                                                            |
| 5     | All stock positions in ascending farm/item UUID order, using the existing M3 advisory keys                                                                                               |
| 6     | Ownership/eligibility/unit and availability checks, then ledger effects in the same transaction                                                                                          |

UUIDs are normalized to lowercase before sorting and hashing. Advisory key formats
remain `(hashtext(organizationId), hashtext(farmId:itemId))` for stock and
`(hashtext(organizationId), hashtext(flock:farmId:flockId))` for flock mutation.
Required farm rows are shared-locked before flock/stock locks, covering lifecycle
updates and their implicit foreign keys. Code allocators acquire the exclusive
organization lock first and never upgrade a parent lock later.

Transaction identity is tracked in a WeakMap, including acquisition in progress.
Later helpers may reuse a subset of the prepared plan. A missing item, stock
position, flock, order, command or stronger definition mode rejects the operation
with `MUTATION_LOCK_PLAN_INCOMPLETE`; helpers never extend or upgrade an acquired
plan. This is internal transaction bookkeeping, not tenant authority or a balance.

`InventoryStockService.postMovementInTransaction` prepares a complete single-item
plan when called on its own. Composed writers must call `lockMutation` with all
required definitions/flocks/stock positions first, then call helpers sequentially
with subsets. The caller owns the READ COMMITTED transaction and must propagate
any failure. Do not recover through a savepoint and reuse the prepared context:
savepoint rollback can release database locks while transaction-local bookkeeping
still exists. Roll back the whole mutation.

The distinction between FOR SHARE and FOR KEY SHARE matters: definition readers
must block non-key updates to unit/category/lifecycle. See PostgreSQL's
[row-lock conflict rules](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).

## Participating entry points and preserved policy

- `InventoryItemsService.create` uses the upfront exclusive parent for code
  allocation. Update, deactivate and reactivate hold the parent and exclusive
  item definition lock throughout checks and writes.
- `InventoryStockService.postMovement` owns one READ COMMITTED transaction;
  `postMovementInTransaction` reuses the caller's transaction. Reads and negative
  stock arithmetic are unchanged. No mutable stock balance is introduced.
- `lockFlockMutation` now obtains the shared parent/farm prefix before its existing
  advisory and row locks. Mortality post/reverse, baseline edits and flock
  close/reactivate keep using that wrapper. `FlocksService.create` takes its code
  allocation parent first and revalidates farm access under the farm lock.
- `FeedUsageService.post` plans item definitions, flock and stock before checking
  active FEED/flock eligibility. Its generated negative ISSUE and FeedUsage still
  commit atomically. Reversal performs only a scoped immutable-source discovery
  before planning, then rechecks farm access and duplicate reversal under locks.
  It derives the original item's frozen unit under lock and appends the same full
  positive ADJUSTMENT/FeedUsage compensation.

Definition checks are scoped to the authoritative organization and all farms;
there is no selected-farm filter on historical dependencies. After waiting for
the exclusive item lock:

- Unit changes are frozen by any inventory movement, historical feed usage,
  SalesProduct reference or non-draft order-line reference.
- Category changes are frozen by historical FeedUsage or a PRODUCE SalesProduct.
  A standalone M3 movement alone does not freeze category.
- Inactive catalog references and reversed/inactive history retain protection.
- Name, description, thresholds and active lifecycle remain editable. Repeating
  the same unit/category does not count as a definition change.
- Forbidden changes return safe HTTP 409 `INVENTORY_DEFINITION_FROZEN`.

Generic M3 movements still permit an inactive owned item, subject to existing
stock/authorization rules. Ordinary feed requires active FEED/flock definitions;
full feed correction still permits the original inactive item or closed flock.
M4 live population remains `startingBirdCount - effectiveMortality`. No sales
depletion is included in metrics or guards.

## Contract changes and callers

Both existing POST contracts now require:

```json
{ "expectedInventoryUnit": "KG" }
```

Allowed values are EACH/KG/G/L/ML. This field is a displayed-unit precondition,
not authority to set or convert a unit. Missing/invalid values fail shared Zod
validation. A valid value differing from the locked item returns HTTP 409
`INVENTORY_DEFINITION_CHANGED` before either ledger commits. Callers must retain
inputs and require reload/review, never silently substitute the new unit and retry.

Affected routes:

- `POST /api/organizations/:organizationId/farms/:farmId/inventory/movements`
- `POST /api/organizations/:organizationId/farms/:farmId/flocks/:flockId/feed-usage`

`createInventoryMovementSchema` and `postFeedUsageSchema` are the active shared
contracts. Their staged V2 names remain aliases to the same schemas; they no longer
represent separate accepted shapes. Population V2 remains staged.

Updated producers/consumers include:

- FarmInventoryController and the internal PostInventoryMovementInput.
- FlocksController's existing shared-input spread and PostFeedUsageInput.
- Inventory movement and flock posting forms: submit the selected displayed unit
  captured at selection as a hidden field, preserving it across refreshed props;
  controlled values clear only on confirmed success.
- Inventory stock and flock server actions: validate and forward that field.
- Management error mapping: safe definition conflict messages without an automatic
  retry. Existing item-edit forms receive the frozen-field conflict through the
  same action error path.
- API/domain fixtures, shared validation tests, server-action tests and the poultry
  browser test's direct movement setup request.

Feed reversal has no new client unit field: its source identity and unit are
server-derived from protected history. No response contract, permission matrix,
authentication flow or public batch endpoint changes.

## Coordinated deployment and rollback

1. Verify the M5-03 migration is applied. The reference checks require its catalog
   and order tables; do not deploy this application against an M4-only schema.
2. Inventory all API instances, web instances, workers, scripts and external
   clients that can write definitions, movements, feed or flock mutations.
3. Pause those mutation paths, drain in-flight requests/transactions and stop old
   writers. Existing read-only traffic can remain available.
4. Deploy the shared contracts, API services and web callers together. Upgrade
   external callers to send their observed unit. The server intentionally does
   not default a missing unit or accept old request shapes.
5. Verify stale-unit/frozen-definition conflicts, negative-stock rollback, feed
   compensation and concurrency tests before resuming only upgraded writers.
   Old browser tabs must reload before posting.
6. Review legacy unit/category meaning before enabling catalog associations.
   Existing M3 movements do not snapshot their original unit; this task makes no
   guesses, conversions or historical balance backfills.

Application rollback also requires a write pause and drain. Preserve the M5-03
additive schema/history. Before catalog/posting activation, a coordinated rollback
of all API/web callers may restore the previous contracts, but definition mutation
must remain disabled until these protections are restored. Once catalog/history
depends on them, do not resume legacy writers that bypass definition locks or
reference guards; repair forward with the barrier in place.

M5-CAT must use the same shared item locks for create/relink/confirmation and the
same flock stage for source eligibility. M5-POP must complete its coordinated
population migration. M5-05 must plan all sources before helpers, authorize fresh
context and retries, enforce whole-order demand/source availability, and post all
effects atomically. None of those later tickets is activated here.

## Verification and limits

The independent `mutation-locks.integration.spec.ts` suite uses the existing
temporary-database helper, real PostgreSQL transactions, promise barriers,
`pg_blocking_pids` and transaction-scoped advisory probes. There are no scheduling
sleeps. Locks and transactions have test bounds.

It covers both winners of unit/movement and category/feed races, deactivation,
flock close versus feed, the three-party FEED/flock/PRODUCE cycle, opposing
multi-item plans, late plan rejection, inactive correction, stale-unit rollback
and inactive/first catalog references. Catalog cases use test-owned transactions;
they do not add a catalog API or sales writer.

The configured development database was found to have M5-03 pending and was left
unchanged. Full API verification runs against a uniquely named disposable database
with the complete committed migration chain. Only that database is dropped;
existing history is never reset, deleted or bypassed. The local test harness used
for this is an ignored temporary artifact, not a new production entry point.

Verification on 2026-11-13:

| Check                                 | Result                                               |
| ------------------------------------- | ---------------------------------------------------- |
| Independent locking/concurrency suite | 11 passed                                            |
| Full API suite                        | 439 passed, 40 files                                 |
| Full web suite                        | 110 passed, 12 files                                 |
| Shared validation suite               | 176 passed, 8 files (existing source/dist discovery) |
| `pnpm format:check`                   | Passed                                               |
| `pnpm lint`                           | Passed                                               |
| `pnpm typecheck`                      | Passed                                               |
| `pnpm build`                          | Passed                                               |
| `git diff --check`                    | Passed                                               |

The successful full invocation was
`pnpm test --concurrency=1 -- --maxWorkers=2`, through the disposable-database
harness. Logs confirmed `turbo run test --concurrency=1 -- --maxWorkers=2` and
`vitest run --maxWorkers=2`. This serializes workspace tasks while preserving two
workers per package and the actual concurrent PostgreSQL transactions within the
locking tests. All five Turbo tasks passed. The independent suite was also run as
`pnpm --filter @ancastle/api exec vitest run src/database/mutation-locks.integration.spec.ts --maxWorkers=2`.

An earlier parallel-workspace `pnpm test -- --maxWorkers=2` run passed all
439 API assertions but failed the existing feed suite's 10-second afterAll
temporary-database DROP. Another loaded run additionally hit a worker-start
timeout. The feed/migration pair passed when isolated, and the complete suite
passed with workspace concurrency limited as above. No existing timeout,
assertion, test fixture protection or concurrency-test bound was relaxed.
Temporary disposal diagnostics were removed, leaving the existing helper unchanged.
The 2026-11-14 final audit subsequently passed the standard
`pnpm test -- --maxWorkers=2` command: API 439, web 110, validation 176; all five
Turbo tasks succeeded without changing timeouts. The final audit added a browser regression for a unit edit followed by soft
navigation. All three poultry/inventory browser cases passed against a disposable
database (`node e2e/run-poultry.mjs`, from `apps/web`). See
[m5-lock-final-audit.md](m5-lock-final-audit.md) for the complete audit, corrections
and final verification status.

Remaining operational limits are old-writer coordination, local parallel test
runner/DDL cleanup sensitivity, existing advisory hash collision serialization,
and the later CAT/POP/posting prerequisites. Arbitrary raw SQL and unmanaged old
writers are not made safe by application locks; the write barrier is required.

## Changed files

- `apps/api/src/database/mutation-locks.integration.spec.ts`
- `apps/api/src/database/mutation-locks.ts`
- `apps/api/src/modules/inventory/farm-inventory.controller.ts`
- `apps/api/src/modules/inventory/farm-inventory.integration.spec.ts`
- `apps/api/src/modules/inventory/inventory-items.service.ts`
- `apps/api/src/modules/inventory/inventory-stock.integration.spec.ts`
- `apps/api/src/modules/inventory/inventory-stock.service.ts`
- `apps/api/src/modules/poultry/feed-usage.integration.spec.ts`
- `apps/api/src/modules/poultry/feed-usage.service.ts`
- `apps/api/src/modules/poultry/flock-metrics.integration.spec.ts`
- `apps/api/src/modules/poultry/flock-mutation-lock.ts`
- `apps/api/src/modules/poultry/flocks.integration.spec.ts`
- `apps/api/src/modules/poultry/flocks.service.ts`
- `apps/web/app/app/flocks/actions.ts`
- `apps/web/app/app/inventory/stock/actions.ts`
- `apps/web/components/flocks/posting-form.tsx`
- `apps/web/components/inventory/movement-form.tsx`
- `apps/web/e2e/poultry.browser.ts`
- `apps/web/lib/management/api.ts`
- `apps/web/lib/management/flock-actions.test.ts`
- `apps/web/lib/management/inventory-actions.test.ts`
- `docs/m5-lock-mutation-locking.md`
- `docs/m5-lock-final-audit.md`
- `packages/validation/src/index.ts`
- `packages/validation/src/inventory.spec.ts`
- `packages/validation/src/sales.spec.ts`
