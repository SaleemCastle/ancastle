# M5-03 sales persistence

This implements the persistence foundation from the [approved M5-01 ADR](m5-01-sales-fulfilment-architecture.md)
and M5-02 shared contracts. It does not activate sales writes or population-v2.

The nine new models are `SalesProduct`, `PoultryProductSource`, `Order`, `OrderLine`,
`OrderEvent`, `Fulfilment`, `FulfilmentLine`, `FlockSaleDepletion` and
`FulfilmentCommand`. The migration is
`apps/api/prisma/migrations/20261113160000_sales_persistence/migration.sql`.

## Stored facts and boundaries

- Orders belong to an organization and reference its customer through a composite
  foreign key. They have no authoritative farm ID. Drafts may change; confirmation
  freezes customer/contact, currency, terms and line snapshots. Draft removal uses
  `isRemoved`; commercial history cannot be deleted. Versioned writes advance the
  order version by one.
- Prices use `Decimal(19,4)` and quantities use `Decimal(18,3)`. All quantities are
  positive; poultry uses EACH and is bounded by Int32; produce EACH requires whole
  units. JMD is enforced by a CHECK. No totals, line amounts, stock balances,
  fulfilment balances or mortality percentages are persisted. Monetary response
  totals remain derived and rounded to two decimals under the ADR.
- CASH has no credit period; CREDIT requires positive integer `creditTermDays`.
  Those days capture due-date intent. No invoice due date or due-date clock is
  introduced; the ADR assigns that to M6.
- Catalog definitions reference same-organization produce items with matching
  category/unit. Poultry definitions have no inventory item. Eligibility has
  scoped farm/flock/product links, a stable identity and active lifecycle.
- Operational rows carry organization/farm scope. Composite foreign keys bind an
  allocation to its exact batch, order line and physical source. Actor links retain
  the global User and same-organization membership, as in M4. These are integrity
  checks, not current permission or farm-access authorization.
- Each produce allocation links a unique negative ISSUE, or positive ADJUSTMENT
  for correction, matching quantity, stock position, actor and occurrence time.
  Linked movements cannot be mutated or reused for feed. Existing feed validation
  is retained, with an additional reciprocal sales-link exclusion trigger.
- Each poultry allocation requires exactly one matching positive depletion row at
  commit. A full reversal references the original batch, every original allocation
  and its original depletion, preserving source, unit and quantity. Unique reversal
  links reject duplicate compensation and reversal of a reversal. Depletion stays
  separate from mortality and inventory.
- Operational events, allocations, depletion, audit events and successful receipts
  reject UPDATE, DELETE and TRUNCATE. An immutable receipt seals its batch against
  later allocation inserts. Restrictive foreign keys preserve referenced history.
- `OrderEvent` stores a JSON object of commercial before/after facts, capped at
  256 KiB, unique per order/version. Future API projections must select commercial
  facts explicitly and continue to omit farm/source details without authorization.

PostgreSQL numeric typmods preserve exact stored precision but round excess input
scale before CHECK constraints run. M5-02 rejects such request input before
persistence; future services must continue to use those contracts rather than
treating database storage as request validation. See PostgreSQL's
[numeric type rules](https://www.postgresql.org/docs/17/datatype-numeric.html).

## Transaction and retry contract for future writers

Future fulfilment writers must insert batch, allocations, physical ledgers and the
success receipt in one transaction, with the receipt last. The deferred
`fulfilments_complete_at_commit` constraint rejects empty/incomplete batches,
missing poultry ledgers, missing receipts and partial batch reversals. This uses
PostgreSQL [deferred constraint triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html).

Receipts are permanent committed successes. They store UUID request key,
POST/REVERSE operation, versioned 64-character lowercase hex request fingerprint,
actor, resulting order version, fulfilment link and original 2xx success status
(default 201). The unique key is `(organizationId, farmId, operation, key)`;
`fulfilmentId` is also unique. There is no PROCESSING state, TTL, Redis deduplication
or duplicated payload. The hash version identifies the future canonical request
algorithm; this ticket does not implement canonicalization or replay handling.

The database rejects a second successful effect for a concurrent duplicate key.
The M5-05 service must additionally serialize key intents, authorize every retry,
compare fingerprint/actor, and return the original immutable receipt before mutable
order/source checks. A uniqueness violation alone does not implement HTTP replay.

## Deployment

1. Keep all sales/catalog write routes unavailable. M5-LOCK, M5-CAT and M5-POP
   prerequisites still apply; this migration is not permission to enable posting.
2. Back up the database and use the pinned repository toolchain. Generate the
   client with `pnpm --filter @ancastle/api db:generate`.
3. Apply with `pnpm --filter @ancastle/api db:migrate:deploy`. Do not reset a
   database or edit an earlier migration. The additive migration is explicitly
   transactional: it adds new tables/types, a customer composite candidate key,
   indexes, foreign keys, CHECKs and triggers. No M1-M4 rows are rewritten.
4. Allow for the customer unique-index build and brief DDL locks on referenced
   tables. Schedule around long-running transactions. Existing feed writes acquire
   the same movement-row lock used by M4 before testing sales-link exclusion.
5. Verify migration status and integrity tests before deploying generated clients.
   There is no data backfill, balance initialization or population cutover.

M5-LOCK must still coordinate inventory definition/unit/category freezes and the
canonical parent/order/definition/flock/stock lock hierarchy. M5-POP must still
switch all population readers and guards together. The new-table integrity
triggers do not replace these prerequisites, check availability/remaining demand,
or grant tenant access. No existing M3/M4 service or metric formula is changed.

## Rollback

Prefer rolling back application code while leaving this unused additive schema in
place. The previous application does not reference the new tables, and migration
tests verify its existing feed writes still work. Never remove a committed receipt
or disable append-only protections to make a retry succeed.

Before any sales data exists, a separately reviewed compensating migration may
remove the new tables/types/functions, the two sales-related triggers on existing
tables, and the new customer candidate key. Inspect dependencies first; do not use
an unreviewed cascading drop. Once any sales history exists, retain it and repair
forward. A failed transactional deployment leaves M4 data intact; inspect Prisma
migration status and follow the normal failed-migration resolution process before
retrying. No destructive down migration is included.

## Verification

The focused `sales.persistence.spec.ts` suite creates two uniquely named disposable
PostgreSQL databases, deploys migrations with the real Prisma CLI, and drops only
those databases in teardown. It needs CREATEDB permission on the configured test
server. It never resets or migrates the database named in `DATABASE_URL`.

One database receives the complete chain from empty; the other receives the M4
chain, customer/flock/mortality/inventory/feed fixtures, and then M5-03. It checks
that legacy facts are unchanged and another M4 feed operation still succeeds.
Prisma structural drift is checked separately; SQL-only constraints/triggers are
exercised by direct persistence tests. Test data for immutable history uses
transaction rollbacks, without disabling triggers.

The suite also covers tenant/farm/source links, required and unique constraints,
decimal storage metadata/boundaries, immutable snapshots/history, exact physical
links and reversals, incomplete commit rejection, scoped idempotency uniqueness
and concurrent duplicate transactions. It does not repeat M5-02 request validation.

Verification on 2026-11-13:

| Check                                                                | Result                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Prisma validate and `pnpm --filter @ancastle/api db:generate`        | Passed                                                |
| Focused persistence/migration suite                                  | 16 tests passed                                       |
| Fresh migration chain, populated M4 upgrade, Prisma structural drift | Passed on disposable PostgreSQL databases             |
| `pnpm format:check`                                                  | Passed                                                |
| `pnpm lint`                                                          | Passed                                                |
| `pnpm typecheck`                                                     | Passed                                                |
| Full tests with `--maxWorkers=2`                                     | API 428 passed; web 109 passed; validation 174 passed |
| `pnpm build`                                                         | Passed                                                |
| `git diff --check`                                                   | Passed                                                |

The local pnpm wrapper consumes an argument separator. The successful root test
invocation was `pnpm test -- -- --maxWorkers=2`, which emitted
`turbo run test -- --maxWorkers=2` and `vitest run --maxWorkers=2`. Unchanged web
and shared-package tasks used Turbo cache. Validation's existing runner count
includes both source and generated `dist` tests. The new migration suite has an
explicit 120-second setup allowance for three real CLI deployments; existing
global test/hook timeouts are unchanged.

Only four source artifacts change: the Prisma schema, additive migration,
focused persistence test file and this document. Generated Prisma output was
regenerated locally and remains ignored under the existing repository convention.
Earlier migrations are unchanged. No unresolved ADR decision is required: credit
days are due-date intent and all activation/locking work remains with the already
defined later tickets. No commit, push, API/UI work or M5-LOCK implementation is
included.
