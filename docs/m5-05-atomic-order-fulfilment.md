# M5-05 atomic multi-source fulfilment

Implements [M5-05](https://trello.com/c/UUnzAEFJ) on
`m5-05/atomic-order-fulfilment`, extending the approved
[M5-01 ADR](m5-01-sales-fulfilment-architecture.md), M5-02 contracts,
[M5-03 persistence](m5-03-sales-persistence.md),
[M5-LOCK](m5-lock-mutation-locking.md),
[catalog eligibility](m5-cat-sales-catalog.md),
[population v2](m5-pop-sales-aware-population.md), and
[M5-04 orders](m5-04-sales-order-management.md). The actual card and dependency
cards were read; dependencies are Done and M5-05 is Review / Testing. Work stops
before commit/push. No production activation or CI/merge result is claimed.

## API and permissions

Routes are under `/api/organizations/:organizationId/farms/:farmId`.
Existing AuthGuard, AuthorizationGuard and FarmAccessGuard run in that order.

| Method | Route                                | Required permissions               | Result                                       |
| ------ | ------------------------------------ | ---------------------------------- | -------------------------------------------- |
| POST   | `/orders/:orderId/fulfilments`       | `order:read`, `fulfilment:post`    | Original immutable command receipt, HTTP 201 |
| POST   | `/fulfilments/:fulfilmentId/reverse` | `order:read`, `fulfilment:reverse` | Full correction receipt, HTTP 201            |
| GET    | `/fulfilments`                       | `order:read`, `fulfilment:read`    | Bounded farm history, including reversals    |
| GET    | `/fulfilments/:fulfilmentId`         | `order:read`, `fulfilment:read`    | One immutable event                          |

OWNER/ADMIN may read/post/reverse. MANAGER/STAFF may read/post. Farm grants remain
independent; these permissions confer no extra farm access or manual inventory
adjustment capability. The service rechecks active user, organization membership,
current role permissions, organization, farm and assignments inside the transaction,
including after waiting for mutation locks and on every replay.

Use the existing shared `postFulfilmentSchema`, `reverseFulfilmentSchema`,
`fulfilmentCommandResponseSchema`, `fulfilmentResponseSchema` and
`fulfilmentListResponseSchema`. No duplicate request/response definitions or new
persistence migration are introduced. Both POST routes require a UUID
`Idempotency-Key` header. Example posting body:

```json
{
    "expectedOrderVersion": 2,
    "occurredAt": "2026-11-15T12:00:00.000Z",
    "allocations": [
        {
            "orderLineId": "11111111-1111-4111-8111-111111111111",
            "kind": "PRODUCE",
            "inventoryItemId": "22222222-2222-4222-8222-222222222222",
            "quantity": "1.250"
        },
        {
            "orderLineId": "33333333-3333-4333-8333-333333333333",
            "kind": "POULTRY",
            "flockId": "44444444-4444-4444-8444-444444444444",
            "quantity": "3"
        }
    ]
}
```

`note` (up to 2,000 characters) and `reference` (up to 120) are optional. A posting
contains 1..100 allocations. Source IDs are selectors, never authority. Quantities
are positive decimal strings with at most 15 integer and three fractional digits;
poultry is integral and Int32-bounded, and produce EACH is integral. Units and
product/source associations are server-derived from locked records. Duplicate
line/source pairs are rejected, including differing UUID case. A line can have
several distinct eligible flock allocations; one flock may supply multiple lines,
with all its requested birds aggregated before checking availability.

The command response is `{ "data": { "operation": "POST", "idempotencyKey":
"<UUID>", "orderVersion": 3, "fulfilment": { ... } } }`. Reversal uses operation
`REVERSE`. Event DTOs use the shared discriminated poultry/produce and
posting/reversal contracts. The order version is the version committed by that
command. UUID-derived `FUL-<UUID>` codes avoid sequential organization code locks.

History query parameters are `page`, `pageSize`, optional `orderId` and `kind`.
The shared limits/defaults apply (maximum page size 100). Data/count use one
REPEATABLE READ transaction and stable occurredAt/createdAt/id ordering. Counts
include only the authorized farm. Organization order reads continue to report
whole-order commercial progress with `sourceDetails.visibility=REDACTED`.
Operational allocations are available through the independently authorized farm
endpoints; nested Prisma relations, receipt hashes and inaccessible source IDs
are never projected. Generic unavailable-source errors contain no source identity.

## Transaction and lock order

Each new posting/reversal owns exactly one READ COMMITTED PostgreSQL transaction.
Scoped discovery determines a complete plan; it establishes neither eligibility
nor availability. `lockMutation` acquires the existing canonical stages:

1. Organization FOR KEY SHARE.
2. Advisory command identity `(organization, farm, operation, UUID key)`.
3. Scoped Order FOR UPDATE.
4. Definitions in fixed table order: Farm, Customer, SalesProduct,
   PoultryProductSource, InventoryItem; sorted canonical UUIDs, FOR SHARE.
5. Sorted farm/flock advisory keys and scoped flock rows FOR UPDATE.
6. Sorted farm/item M3 stock advisory positions.
7. Fresh authorization, receipt lookup, then state/version, eligibility,
   whole-order remaining demand and source availability checks; physical effects.

Only applicable stages/definitions are included. Correction needs the original
farm/item/flock identities, not current product eligibility. Helpers may reuse
subsets of the complete prepared plan; no late lock-plan extension is introduced.

Posting requires a CONFIRMED order and active customer/product/farm/sources. The
selected product kind/unit/item must match the immutable confirmed line. Poultry
requires an active explicit same-product/farm/flock association and active flock.
Produce requires the exact active PRODUCE inventory item/unit. Demand is summed
per order line across every farm and reduced by full reversals. Requested poultry
is summed per flock and checked against the canonical M5-POP population authority
`S - M - B` after locks. No mortality reinterpretation or inventory bird record is
created. Produce uses M3 `postMovementInTransaction` for every negative ISSUE;
its existing locked ledger arithmetic prevents aggregate negative stock even
when several order lines use the same item.

The transaction writes the immutable batch, allocations, M3 movements and poultry
depletions, increments the order version once, and writes the immutable command
receipt last. Deferred M5-03 constraints validate completeness at commit. An error
propagates out of the transaction, rolling back every effect and the version.
There is no independent inventory commit, savepoint recovery, reservation, stock
counter or partial-success response.

## Idempotency and cancellation

Scope is exactly `(organizationId, farmId, operation, key)`. Hash version 1 is
SHA-256 over a stable server serialization of operation/target, expected order
version, normalized occurrence time, optional note/reference, and sorted
line/kind/source/decimal allocations; reversal instead includes original batch,
reason and attestation. UUID case, allocation order and equivalent decimal/time
spellings normalize. Actor is independently bound to the persisted receipt.

After fresh authorization, matching actor/hash/version returns the original
immutable resource, order version and stored success status. It creates no rows
or version increment. Lookup precedes mutable order state/version, stock,
customer and source eligibility checks, so cancellation, correction or source
deactivation does not invalidate a committed success. A different actor or
payload returns safe 409 `IDEMPOTENCY_CONFLICT` without disclosing prior intent.
The advisory identity serializes concurrent keys; permanent database uniqueness
is the final guard. Failed transactions retain no receipt/key claim. There is no
PROCESSING state, expiry, Redis cache or order-creation idempotency change.

M5-04 cancellation shares the order lock. Partial cancellation closes remaining
demand, preserving physical history; a fully fulfilled order cannot be cancelled.
If a posting wins, an already-submitted cancellation with the old version fails
and must be reviewed against the new version/remainder. If cancellation wins,
posting fails without physical effects. A new posting with the current version
still cannot fulfil a cancelled order. Cancellation never reverses or deletes a
posting. Receipts remain replayable while the deployment gate is enabled.

## Full posting-error correction

Reversal body requires `expectedOrderVersion`, `occurredAt`, nonempty `reason`
(up to 2,000 characters), and `postingErrorConfirmed: true`; `reference` is optional.
The attestation means the compensated quantity was not actually handed over.
This is a recorded posting error, not a customer return, cancellation remedy or
payment correction.

An authorized reversal appends one REVERSAL batch at the original farm/order,
referencing every original allocation with the same quantity/unit/source snapshot.
Produce appends positive M3 ADJUSTMENT movements. Poultry appends full positive
depletion reversal records that subtract from effective B. Originals stay intact.
Closed flocks and inactive items/products are allowed for correction; the farm
must still be active and authorized. A cancelled order can be corrected, but its
restored unfulfilled demand stays cancelled. Double reversal and reversal of a
reversal are rejected; unique links enforce this independently in PostgreSQL.
Partial correction/replacement is excluded. A replacement posting is a separate
intent and transaction and must satisfy current order/source conditions.

## Deployment activation checklist

`SALES_FULFILMENT_ENABLED` defaults to `false`. Missing, `false`, or any unrecognized
runtime value fails closed. Environment validation accepts only `false`/`true`.
The controller and central service enforce the gate, including another service
check after locks. No request/header/UI flag enables it. Both new posting and
correction are disabled together; authorized history reads remain available.
Code merge, migration, permissions and test fixtures do not turn it on.

The signed manifest is an operator-reviewed deployment artifact, not a public API
capability claim. Operators must verify and retain the following evidence before
explicitly setting the server environment value to `true` in a coordinated release:

- [ ] M5-03 migration `20261113160000_sales_persistence` is successfully applied.
- [ ] M5-LOCK compatible writers are deployed; old API, web actions, internal jobs,
      scripts and in-flight legacy transactions are drained behind a write pause.
- [ ] M5-POP v2 readers/guards and rebuilt shared packages are deployed everywhere.
      Record API/web/shared build IDs, release owner and deployed instance inventory.
- [ ] M5-CAT and M5-04 are ready, with catalog/source administration operational.
- [ ] Inventory external consumers, including reports, scripts, mobile/cached clients
      and scheduled jobs; record each owner, v2 acceptance evidence and sign-off.
- [ ] While the gate stays closed, verify B=0 compatibility and synthetic-B tests
      in disposable environments, tenant/farm isolation and stale-client reload.
- [ ] Verify and sign the manifest containing the above evidence, gate approver,
      timestamps, deployment identifiers and rollback-compatible build IDs.
- [ ] Explicitly enable the server gate, resume only compatible writers, and verify
      the first permitted posting refreshes existing flock routes through S-M-B.

Production migration/deployment, old-writer drain, consumer inventory/sign-off and
the manifest are **NOT VERIFIED** here. Production activation remains **BLOCKED**.
No production configuration is changed. An example false setting is documented in
`.env.example`; only disposable integration tests set it true.

For rollback, disable posting/correction first, pause and drain writers, retain
the additive schema, immutable receipts and all ledgers, and deploy only compatible
population-v2 builds once any sales history exists. Do not restore mortality-only
writers, delete history, reset B or post a false reversal to permit rollback.
Prefer repair forward; reenable only after repeating the manifest checks.

## Verification and limitations

See [the verification report](m5-05-verification.md) for executed commands/results.
The [final pre-merge audit](m5-05-final-audit.md) records the later focused
idempotency correction, expanded test coverage and fresh verification.
Concurrency tests use real commits, promise barriers and `pg_blocking_pids` with
bounded polling, without scheduling sleeps or production test hooks. One domain
transaction pauses after its effects and receipt but before commit; its competitor
must be observed waiting before release. Tests cover produce and bird competition,
same-order demand/version, identical/conflicting keys, mortality in both winner
orders, feed, cancellation in both winner orders, stock ISSUE versus reversal,
and concurrent double reversal. Additional injected pre-commit failures prove
both sealed posting and reversal roll back their receipts and physical effects.
Existing test timeouts are unchanged.

Remaining limits: one farm per command; separate postings/replacement commands
are not one transaction; availability is current ledger availability rather than
a historical time balance; pagination is offset based; advisory hash collisions
can serialize unrelated mutations. Unmanaged raw SQL and old writers bypassing
the application protocol remain an operational risk requiring the write barrier.
The gate relies on the deployment operator's manifest verification; this repository
has no production deployment system or external-consumer registry to attest to it.
No sales UI, invoices, payments, receivables, delivery tracking or returns are added.
