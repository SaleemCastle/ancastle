# M5-04 Sales Order Management API

This API implements organization-scoped commercial orders using the M5-01 ADR,
M5-02 shared contracts, M5-03 persistence and M5-06 terms. It does not create
physical fulfilments or financial records.

## Endpoints and permissions

All routes require bearer authentication and an active membership in the
organization named by the route. The organization route parameter selects the
membership to verify; it is never authority supplied by the caller.

| Method  | Route                                                        | Permission      | Result                                                                    |
| ------- | ------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------- |
| `POST`  | `/api/organizations/:organizationId/orders`                  | `order:manage`  | Create a DRAFT from active same-organization customer and catalog records |
| `GET`   | `/api/organizations/:organizationId/orders`                  | `order:read`    | Search, filter and paginate scoped order summaries                        |
| `GET`   | `/api/organizations/:organizationId/orders/:orderId`         | `order:read`    | Commercial snapshots and derived line/order fulfilment progress           |
| `PATCH` | `/api/organizations/:organizationId/orders/:orderId`         | `order:manage`  | Amend a DRAFT with `expectedOrderVersion` and stable line operations      |
| `POST`  | `/api/organizations/:organizationId/orders/:orderId/confirm` | `order:confirm` | Confirm and freeze current customer/product/price/term snapshots          |
| `POST`  | `/api/organizations/:organizationId/orders/:orderId/cancel`  | `order:cancel`  | Cancel a DRAFT or close outstanding CONFIRMED demand with a reason        |
| `GET`   | `/api/organizations/:organizationId/orders/:orderId/events`  | `order:read`    | Paginated append-only commercial audit events                             |

OWNER, ADMIN and MANAGER have the write permissions; STAFF has `order:read`.
The shared authorization guard enforces membership and permission before the
service runs. Missing or foreign-organization order/customer/product identities
use scoped safe not-found responses. All request schemas are strict shared Zod
contracts; state, version, organization, actor, snapshots and totals cannot be
submitted as authority.

## Order behavior

- Creation requires a same-organization active customer and active catalog
  products. Product kind, unit and produce inventory identity are loaded and
  snapshotted by the server. Request `expectedProduct` values are stale-identity
  preconditions only. Prices remain exact JMD `Decimal(19,4)` values; line totals
  are derived using per-line half-up rounding to two decimal places and summed.
- Draft amendments apply stable ADD/UPDATE/REMOVE line operations inside one
  transaction, revalidate the complete resulting active order, and append an
  AMENDED event. Removed lines remain as audit history. `expectedOrderVersion`
  and the order row lock prevent silent lost updates.
- Confirmation revalidates the active customer and catalog identities, refreshes
  server-owned customer/product display snapshots, and atomically freezes the
  order and appends a CONFIRMED event. Repeating confirmation returns the already
  confirmed order without another event. Confirmation does not reserve stock.
- Cancellation accepts DRAFT or CONFIRMED orders with unfulfilled demand. It
  closes only the outstanding remainder, preserves fulfilled history, and
  appends one CANCELLED event. A fulfilled order cannot be cancelled. Repeating
  cancellation returns the existing cancelled order without another event.
  Cancelled orders cannot reopen.
- Whole-order commercial quantities/totals are organization-scoped. Operational
  source IDs, farm availability and histories are omitted; detail responses use
  `sourceDetails: { visibility: "REDACTED" }`. Event projections contain only
  commercial customer/product/price/quantity facts.
- Progress is derived from fulfilment line postings/reversals across the complete
  order, never from an accessible-farm subset or a persisted balance. Progress
  filtering is applied before pagination. No fulfilment writes are exposed here.

Transactions use PostgreSQL READ COMMITTED and the M5-LOCK protocol: organization
parent first, then order where applicable, then customer/product definition rows
in deterministic table/UUID order. Order commands skip the ADR's fulfilment-only
idempotency stage. Mutations append their event and advance the order version in
the same transaction; PostgreSQL snapshot and append-only triggers remain the
final integrity boundary.

## Creation retry behavior and deferred design

Order creation is **not idempotent** in M5-04. Repeating a successful POST,
including after a lost response, creates another draft with a new order ID/code.
No idempotency header is interpreted, and the fulfilment-only
`FulfilmentCommand` is not reused. This is an explicit M5-04 architecture
decision: the M5-01 ADR scopes persisted idempotency to fulfilment and reversal,
and no order-command receipt schema or migration is approved. A future architecture
decision must define order creation retry identity, payload canonicalization,
actor/scope binding, receipt retention, response replay and concurrency behavior
before creation retries can be guaranteed. Draft amendments and lifecycle
transitions are protected by order locking and optimistic versions, but they do
not have command receipts.

## Scope and rollout limitations

This API creates no inventory reservation or movement, fulfilment/allocation,
flock sale depletion, invoice, payment, receivable or due date. CASH remains
commercial intent, CREDIT stores positive `creditTermDays`, and JMD is the only
currency. Fulfilment posting remains dependent on its own M5 work and does not
activate by merging these order APIs. The API has no frontend order-management
workflow in this task.

## Verification

PostgreSQL integration coverage exercises create, read/list, exact price
snapshots, draft amendments, confirmation/cancellation, cross-organization
isolation, STAFF read-only behavior, event history, retry semantics and
concurrent stale-version races.

Verification on 2026-11-15:

| Command                                                                                                                                                 | Result                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm --filter @ancastle/api test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000 src/modules/sales-orders/sales-orders.integration.spec.ts` | Passed: 1 file, 10 tests                                                       |
| `pnpm --filter @ancastle/api test -- --maxWorkers=2`                                                                                                    | Passed: 42 files, 466 tests                                                    |
| `pnpm --filter @ancastle/validation test -- --maxWorkers=2`                                                                                             | Passed: 8 files, 178 tests (includes source and generated distribution suites) |
| `pnpm --filter @ancastle/web test -- --maxWorkers=2`                                                                                                    | Passed: 13 files, 116 tests                                                    |
| `pnpm format:check`                                                                                                                                     | Passed                                                                         |
| `pnpm lint`                                                                                                                                             | Passed; API lint reported zero warnings and zero errors                        |
| `pnpm typecheck`                                                                                                                                        | Passed: all four workspace packages                                            |
| `pnpm build`                                                                                                                                            | Passed: all four workspace packages                                            |
| `git diff --check`                                                                                                                                      | Passed                                                                         |

The combined root regression invocation `pnpm test -- -- --maxWorkers=2`
completed 450 API tests and all 116 web tests, then exited nonzero because Vitest
reported one unhandled `Timeout starting forks runner` while Turbo was running
package test tasks concurrently. The API, validation and web packages were then
run independently with two workers and all passed at the counts above. The
isolated API rerun completed without a runner error. This is observed as a
constrained-runner startup/scheduling limitation; it does not establish that all
possible combined-runner environments are free from the timeout. No test
timeout increase was committed.

The full package regression runs preceded the final addition of confirmed-order
cancellation/retry assertions to the existing integration test. The affected
PostgreSQL integration file was rerun after that test-only edit and passed 10/10.

No Prisma schema or migration change is included. No order creation retry
idempotency is provided: an identical replay creates a second DRAFT; draft
mutation and lifecycle requests instead rely on order locks, expected versions,
transactional event insertion and database append-only/immutability triggers.

The API does not create fulfilments, so cancellation tests cover DRAFT and
CONFIRMED orders without prior fulfilled quantities. Cancellation derives the
unfulfilled remainder from all persisted fulfilment lines, but a
partial-fulfilment/cancel interaction remains a follow-up regression case once
M5-05 posting fixtures or a dedicated persistence fixture are available.

## Final pre-merge audit

### Concurrency and transaction integrity

Source review confirms draft amendment, confirmation and cancellation use the
shared `lockMutation` protocol. The organization parent is locked before the
order; amendment and confirmation then lock customer/product definitions in
deterministic order. Order commands skip the fulfilment-only idempotency lock.
Cancellation does not require definitions, stock or flock locks. Each path
reloads state and validates `expectedOrderVersion` after acquiring locks.
Amendment, confirmation and cancellation update the order/version and append
their lifecycle event inside the same PostgreSQL transaction. The order version
predicate protects against stale writers, and the migration's append-only and
snapshot-immutability triggers provide database enforcement. Repeated
confirmation/cancellation of an already completed target state returns without
adding a duplicate event. Rejected/stale operations roll back their transaction.

The PostgreSQL API tests exercise concurrent amendment and confirm/cancel races
and assert the single winning state/event. They use overlapping `Promise.all`
requests, but do not hold a database row lock behind a deterministic barrier;
they prove the observable conflict behavior, not every possible scheduler
interleaving. No application deadlock was found in the reviewed order-only lock
paths. M5-05 must join the same order lock protocol before any source locks.

### Authorization and commercial data

Tenant queries use the authenticated organization context, and customer and
product ownership is loaded/scoped within that organization. Central permission
guards distinguish order read, manage, confirm and cancel capabilities; STAFF
is read-only. Commercial totals are visible at order scope while farm, flock,
inventory source identifiers and availability details are redacted from order
and event projections. Validation and business errors use safe external
messages; database exceptions are not serialized into client responses.

Prices remain Prisma Decimal values, with JMD as the only accepted currency.
Unit prices are bounded to the Decimal(19,4) contract. Calculations use a
high-precision Decimal context, round each line total half-up to two places,
then sum the rounded line totals. Confirmation stores the authoritative
customer/product/price/term snapshots; subsequent catalog changes do not rewrite
the order history. The integration test verifies a fractional quantity and
unit price against the expected rounded line/order total.

### Test runner failure investigation

The earlier combined run passed 450 API tests and 116 web tests before Vitest
reported `Timeout starting forks runner`; isolated API, validation and web
runs subsequently passed. An uncached rerun was started with:

```text
$env:TURBO_FORCE='true'; pnpm test -- -- --maxWorkers=2
```

Turbo scheduled the uncached validation, API and web test tasks together. The
machine reports 8 available logical processors, while `--maxWorkers=2` is
applied separately inside each package's Vitest invocation. This allows up to
six test workers across the three simultaneously running packages, in addition
to Turbo/build activity. The repository Vitest configs do not set a custom
fork startup timeout. In the forced concurrent run, validation passed 178/178
and web passed 116/116. API completed 450 passing tests but the
`sales.persistence.spec.ts` setup hook hit its existing 120-second limit;
its 16 tests were skipped and the package exited 1. The API suite's 10 M5-04
sales-order integration tests passed in that same run. Running the migration
suite alone immediately afterward with
`pnpm --filter @ancastle/api test -- --maxWorkers=2 src/database/sales.persistence.spec.ts`
passed all 16 tests in 68.31 seconds (exit 0). This paired evidence supports
resource contention from concurrent disposable-database migration setup, not
an application deadlock or a Vitest forks-startup defect. The first earlier
`Timeout starting forks runner` report was not reproduced in this uncached run.
The combined command exited 1 after 8m39.453s. Focused M5-04 API integration
rerun passed 10/10 (exit 0). Final audit quality gates passed: `pnpm
format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and `git diff
--check` (all exit 0).

This provides a reproducible way to test worker scheduling pressure, but a
single pass or failure cannot establish a production application deadlock.
No timeout was increased and no runner configuration was changed during this
audit. Repeatable verification is to run package suites independently with
`--maxWorkers=2` when concurrent disposable-database migration setup reaches
the 120-second hook limit. The migration rerun, API suite and prior validation
and web package runs passed independently.

### M5-05 integration handoff

The cancellation service computes remaining demand from all persisted
fulfilment allocations and does not delete or reverse fulfilment history. A
confirmed order may be cancelled only while unfulfilled demand remains; a fully
fulfilled order cannot be cancelled. Partial-fulfilment cancellation is not
covered by current M5-04 fixtures because this task does not post fulfilments.

M5-05 must add PostgreSQL integration coverage for both order-lock race
orderings: fulfilment commits first, after which cancellation recomputes the
remainder/version; and cancellation commits first, after which fulfilment
rejects the cancelled order before any ledger effects. Tests must also cover
partial fulfilment then cancellation, correct remaining/cancelled quantities,
immutable prior fulfilment history, reversal/correction after cancellation,
and absence of partial stock or flock effects on rejection. These are required
handoff tests, not implementation in M5-04.

### Audit result

No M5-04 business-logic correction was identified or made during this audit.
Order creation retry remains intentionally non-idempotent, and concurrent
mutations are protected by locks and optimistic versions rather than persisted
command receipts. M5-05 must preserve the canonical order-first lock order and
provide the fulfillment race coverage above. Final merge recommendation:
**SAFE TO MERGE**, with M5-05 partial-fulfilment and fulfilment-versus-cancel
integration coverage required before fulfilment is enabled. The combined root
run remains sensitive to PostgreSQL migration setup contention; use independent
constrained package runs for repeatable verification.

### CI stabilization verification

The GitHub Actions workflow previously used one `pnpm test` step. That invokes
Turbo, which schedules the API, validation and web test tasks concurrently.
The workflow now runs the package scripts in three sequential steps, keeping
the existing API environment (`DATABASE_URL`, `REDIS_URL`, `setup-env.ts`) and
using two Vitest workers for API. Validation and web use their existing Vitest
scripts without added timeout or worker overrides. The tests and migration
coverage remain enabled; the other CI checks and their order are unchanged.

Sequential regression results from 2026-11-15:

| Exact command                                                                                                  | Result                             |  Elapsed |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------: |
| `pnpm --filter @ancastle/api test -- --maxWorkers=2`                                                           | Exit 0; 42 files, 466 tests passed | 259.07 s |
| `pnpm --filter @ancastle/validation test`                                                                      | Exit 0; 8 files, 178 tests passed  |  14.42 s |
| `pnpm --filter @ancastle/web test`                                                                             | Exit 0; 13 files, 116 tests passed |  23.52 s |
| `pnpm --filter @ancastle/api test -- --maxWorkers=2 --reporter=verbose src/database/sales.persistence.spec.ts` | Exit 0; 1 file, 16 tests passed    |  83.85 s |

The standalone migration run printed an elapsed setup of **50,143 ms** for
creating two disposable PostgreSQL databases, deploying the fresh and M4/M5
migration chains, seeding the M4 compatibility fixture, and completing the
upgrade. The setup remains under its existing 120-second hook timeout when
tests run sequentially. The verbose reporter was used only to expose this
existing hook duration; no test code, timeout, or database coverage was
retained as a change.

Final quality gates after the CI and documentation edits: `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check` all passed.

The locally executed GitHub Actions equivalent passes all package suites
sequentially. Hosted required CI still must pass on the resulting PR commit
before merge; this local evidence does not substitute for branch protection.
