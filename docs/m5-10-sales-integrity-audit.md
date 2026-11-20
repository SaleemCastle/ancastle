# M5-10 Sales Integrity Audit

Date: 2026-11-19  
Branch: `m5-10/sales-isolation-concurrency-audit`  
Scope: M5-01 through M5-09 plus M5-LOCK, M5-CAT and M5-POP. This is a source and
local verification audit; it is not a production deployment certification.

## Audit scope and method

Read the M5-10 Trello acceptance criteria and the approved [M5-01 ADR](m5-01-sales-fulfilment-architecture.md),
then inspected the sales API/services/controllers, shared schemas, Prisma schema
and migrations, M1 authorization and ledger tests, M3 inventory code, M4 flock
population code, M5 browser workflows and prior LOCK/CAT/POP/fulfilment audits.
The M5-10 Trello card was already in **In Progress**. No card movement was needed.

Coverage labels below mean:

- **Direct**: an executed assertion exercises the invariant at the stated
  boundary.
- **Indirect**: implementation or a related test provides evidence, but the
  exact interaction/schedule is not asserted.
- **Not covered**: no assertion was found for that scenario.

Test names are locators only; coverage claims are based on inspected assertions
and the execution results recorded below. Severity is the consequence if the
invariant were violated, not a claim that the defect currently exists.

## Coverage matrix

| Risk / invariant                                                                                                     | Implementation location                                                                                                | Existing test evidence                                                                                                                                                                   | Test type                                       | Coverage | Missing scenario                                                                            | Severity | Proposed action                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Customer, order and product reads/writes stay in the selected organization                                           | `sales-orders.service.ts`, `sales-catalog.service.ts`, customer service; organization context                          | `sales-orders.integration.spec.ts` cross-org selectors and spoofed IDs; catalog scope cases; M1 organization isolation                                                                   | PostgreSQL API                                  | Direct   | None found for ordinary order/catalog paths                                                 | Critical | None                                                                        |
| Foreign fulfilment/order/source IDs do not disclose existence or identity                                            | `fulfilments.service.ts` scoped order/event/source queries and allowlist projections                                   | `fulfilments.integration.spec.ts` foreign IDs, unauthorized farm, safe unavailable errors and response assertions                                                                        | PostgreSQL API                                  | Direct   | None found in covered API paths                                                             | Critical | None                                                                        |
| Produce/farm operational access requires a current grant                                                             | `FarmAccessService.farmWhere`, `FarmAccessGuard`, fulfilment authorization                                             | catalog grant visibility, fulfilment auth cases, M1 farm access/revocation suites                                                                                                        | PostgreSQL API                                  | Direct   | Revocation while a fulfilment transaction is already in progress was absent                 | Critical | Added deterministic transaction-lock regression; see below                  |
| STAFF receives commercial order visibility without inaccessible farm/source IDs                                      | sales order/history projectors; explicit fulfilment DTO projection                                                     | fulfilment STAFF whole-order history test checks totals/progress and absence of farm/flock/item IDs; commercial read redaction test                                                      | PostgreSQL API                                  | Direct   | None found for the audited projections                                                      | High     | None                                                                        |
| API errors do not reveal foreign source identity, request hashes or internals                                        | `BusinessException`, `HttpExceptionFilter`, service messages/projections                                               | foreign-source failure assertions; filter tests assert sensitive database text is absent; receipts omit hashes                                                                           | PostgreSQL API/unit                             | Direct   | No exhaustive fuzzing of every possible database adapter error                              | High     | Keep stable allowlisted errors; broader fuzzing is optional                 |
| Idempotency identity is organization/farm/operation scoped and receipts are permanent                                | `FulfilmentCommand` unique `(organizationId,farmId,operation,key)`; fingerprint and replay in `fulfilments.service.ts` | persistence immutable-receipt test; API same-key replay/conflict; same organization key accepted at a second farm; new persistence assertion commits valid receipts in two organizations | PostgreSQL persistence/API                      | Direct   | None found for scoped uniqueness/replay boundary                                            | High     | None                                                                        |
| M3 inventory movements are append-only and stock is movement-derived                                                 | inventory movement migration/triggers; `InventoryStockService`                                                         | inventory persistence immutability and exact stock tests; concurrent outbound movement test                                                                                              | PostgreSQL persistence/API                      | Direct   | None found for implemented M3 paths                                                         | Critical | None                                                                        |
| Produce fulfilment posts exactly one matching negative ISSUE atomically                                              | `FulfilmentsService.post`, `InventoryStockService.postMovementInTransaction`, deferred persistence checks              | produce-only/mixed posting, mixed late-source rollback, full fulfilment trigger/link tests                                                                                               | PostgreSQL API/persistence                      | Direct   | None found for covered source kinds                                                         | Critical | None                                                                        |
| Produce quantity precision remains Decimal(18,3), with no float drift                                                | Prisma item movement/fulfilment quantity fields; Zod decimal-string validation                                         | 1.125 produce posting/reversal and exact remaining stock/demand; overflow/precision persistence constraints; validation rejects excess scale                                             | PostgreSQL API/persistence/shared               | Direct   | None found                                                                                  | High     | None                                                                        |
| Inventory item unit/category meaning cannot race with a sale                                                         | M5-LOCK item definition SHARE locks; M3 item mutation uses UPDATE lock; expected-unit recheck                          | mutation lock integration; catalog unit/link races; fulfilment authoritative-unit checks                                                                                                 | PostgreSQL API                                  | Direct   | None found for the audited inventory definition paths                                       | Critical | None                                                                        |
| Poultry population-v2 derives saleable headroom from baseline, mortality and sale depletion, not InventoryItem stock | `poultry-history.ts`, `flock-metrics.ts`, M5-POP queries                                                               | population-v2 tests verify mortality and depletion projections, reversal restoration and organization/farm scope                                                                         | PostgreSQL API/unit                             | Direct   | No stress test over very large ledgers                                                      | High     | None                                                                        |
| Mortality and sales depletions remain distinct append-only ledgers                                                   | flock sale-depletion model/triggers; M4 mortality service                                                              | M4/M5 tests compare separate mortality and sale totals, preserve mortality percentage, and verify compensation without rewriting mortality                                               | PostgreSQL API/persistence                      | Direct   | None found                                                                                  | Critical | None                                                                        |
| Poultry is never an InventoryItem and requires integer EACH quantities                                               | catalog discriminator and no inventory link for POULTRY; shared schemas and fulfilment validator                       | catalog typed-product assertions; schema rejects fractional birds; API enforces whole EACH and records flock depletion only                                                              | Shared/API/persistence                          | Direct   | None found                                                                                  | Critical | None                                                                        |
| Catalog/source eligibility matches source kind, organization, farm, flock and active state                           | `sales-catalog.service.ts`, fulfilment source revalidation and source locks                                            | catalog active/foreign/closed source cases; definition edit and source mutation races; fulfilment ineligible source cases                                                                | PostgreSQL API                                  | Direct   | None found for declared eligibility rules                                                   | High     | None                                                                        |
| No negative stock/live population; competing orders cannot oversell a shared source                                  | stock-position advisory lock and flock advisory/row locks; movement/history aggregates                                 | concurrent fulfilments for produce and poultry with real `pg_blocking_pids`; only one consumes last available quantity; M3 outbound concurrency and M4 mortality concurrency             | Deterministic PostgreSQL concurrency            | Direct   | Exhaustive scheduler/model checking is not performed                                        | Critical | None                                                                        |
| Lock acquisition uses one canonical parent → command → order → definitions → flocks → stock sequence                 | `database/mutation-locks.ts`; helper subset checks reject incomplete plans                                             | mutation-lock integration verifies ordering/canonicalization/plan coverage; inter-writer concurrency cases exercise stock/flock waits                                                    | PostgreSQL/API                                  | Direct   | No throughput or deadlock stress benchmark                                                  | Critical | None                                                                        |
| Fulfilment versus cancellation and order update serialize on the order                                               | `SalesOrdersService` and fulfilment order `FOR UPDATE` lock                                                            | deterministic both-winner cancellation races; stale version conflict tests                                                                                                               | PostgreSQL concurrency/API                      | Direct   | None found for covered transitions                                                          | High     | None                                                                        |
| Fulfilment versus inventory adjustment/feed/mortality serializes and rechecks availability                           | shared stock/flock locks across M3/M4/M5                                                                               | new sale vs outbound ADJUSTMENT cases in both winner orders; sale vs mortality both-winner cases; fulfilment/feed and feed-first cases; stock ISSUE vs reversal; derived assertions      | Deterministic PostgreSQL concurrency            | Direct   | Every combination of multiple source classes is not enumerated                              | Critical | None                                                                        |
| Source definition mutation cannot race into an invalid posting                                                       | fixed-order definition locks and locked-source revalidation                                                            | catalog relink/unit/source closure races; stale lock-plan rejection; concurrent attachment uniqueness                                                                                    | PostgreSQL API                                  | Direct   | None found for tested mutable definitions                                                   | High     | None                                                                        |
| Farm grant revocation cannot race through the fulfilment transaction                                                 | `lockMutation` holds organization `FOR KEY SHARE`; `UsersService.replaceFarmAccess` takes organization `FOR UPDATE`    | New test pauses a real posting before commit, observes revocation waiting in `pg_blocking_pids`, releases posting, then verifies a later STAFF post is forbidden                         | Deterministic PostgreSQL concurrency/API-domain | Direct   | This ordering does not prove behavior of unmanaged writers that bypass the application lock | Critical | No production change; retain deployment write barrier for unmanaged writers |
| Draft/confirmed/cancelled lifecycle and immutable confirmed snapshots                                                | `SalesOrdersService`; database snapshot protections                                                                    | order API tests cover draft amendment, confirm, cancel, stale versions, exact JMD amount and frozen snapshots; persistence triggers reject history edits                                 | PostgreSQL API/persistence                      | Direct   | None found                                                                                  | High     | None                                                                        |
| Partial fulfilment, cancellation remainder and full-batch reversal are consistent                                    | fulfilment history-derived progress and reversal rules                                                                 | partial two-farm posting, cancelled residual, full mixed correction, double-reversal rejection and reversal-race tests                                                                   | PostgreSQL API/persistence                      | Direct   | Customer returns are intentionally not modeled                                              | High     | Keep returns out of M5; correction requires attested posting error          |
| Idempotent retry replays only identical actor/payload; conflicting payload stays safe                                | canonical hash, command lock and immutable receipt                                                                     | same-key same-body replay, same-key different-body conflict, concurrent identical keys and concurrent reversal replay; revoked actor replay denial                                       | PostgreSQL API/concurrency                      | Direct   | Cross-organization reuse pairwise API assertion noted above                                 | High     | None for current implementation                                             |
| JMD price precision/rounding and CASH/CREDIT intent do not invent accounting                                         | order snapshot/rounding code and strict shared contracts                                                               | exact 4-decimal price, line half-up/two-decimal totals, CASH/CREDIT validation and snapshot tests; tests assert no invoice/payment models/effects                                        | Shared/API/persistence                          | Direct   | M6 receivables/payment reconciliation is out of scope                                       | High     | Do not add M6 accounting here                                               |
| Customer purchase history is net posted quantity less full reversals, independent of order state                     | sales history query and DTO                                                                                            | customer history test crosses confirmed/cancelled orders and reversed batches; foreign customer scope and STAFF redaction asserted                                                       | PostgreSQL API                                  | Direct   | Monetary customer ledger is not implemented                                                 | High     | Keep history quantity/commercial only; no M6 work                           |
| Depletion writer remains off unless explicitly enabled; no production flag/config is changed by audit                | `FulfilmentActivationService`, environment validation                                                                  | controller and internal writer fail closed for unset/false/malformed values; env default inspected                                                                                       | PostgreSQL API/config                           | Direct   | Production deployment state cannot be proven from this repository                           | Critical | Keep disabled; use the M5-05 activation/write-barrier procedure             |

## Existing evidence and new test

Existing coverage was already broad. The main evidence is:

- `apps/api/src/modules/fulfilments/fulfilments.integration.spec.ts`: API
  authorization, redaction, source availability, exact ledgers, rollback,
  lifecycle, replay, deterministic stock/flock/order concurrency, and purchase
  history.
- `apps/api/src/database/sales.persistence.spec.ts`: fresh migration/schema
  checks, tenant-safe composite ownership, immutable confirmed snapshots,
  append-only fulfilment/depletion/movement/receipt constraints, deferred
  complete-batch checks and idempotency receipt constraints.
- `apps/api/src/modules/sales-orders/sales-orders.integration.spec.ts` and
  `sales-catalog/sales-catalog.integration.spec.ts`: order lifecycle and catalog
  eligibility/definition races.
- M3 `inventory-stock.integration.spec.ts`, `inventory-movement.persistence.spec.ts`,
  M4 `flock-metrics.integration.spec.ts`, and the M1 farm-access and security
  suites provide regression evidence at their own service and persistence
  boundaries.
- `packages/validation/src/sales.spec.ts` exercises strict JMD, terms, source
  discriminators, integer birds, exact decimal quantities and response redaction.
- `apps/web/e2e/orders.browser.ts` contains real API/browser workflows for mixed
  poultry and produce order management, partial fulfilment and reversal.

**New tests:**

- `serializes farm grant revocation against an in-flight fulfilment` in
  `fulfilments.integration.spec.ts`. It uses a real PostgreSQL transaction
  barrier and `pg_blocking_pids`, not a sleep. It verifies the existing lock
  ordering: the posting holding the organization shared lock commits first;
  grant replacement waits and then commits; a subsequent operation under the
  revoked grant is denied.
- `allows the same idempotency key in separate organizations` in
  `sales.persistence.spec.ts`. It creates two valid tenant scopes, commits both
  fulfilment receipts with one UUID key and verifies both organization-owned
  rows persist.
- `fulfilment versus outbound inventory adjustment` in both winner orders in
  `fulfilments.integration.spec.ts`. The transaction barrier proves the shared
  stock lock permits only one of a 7-unit sale or 7-unit outbound adjustment
  against 10 units; the final movement-derived stock is 3.

These close the three missing high-risk scenario proofs found in the inventory.
No production change was necessary.

## Findings by severity

### Critical / High

No demonstrated production defect found in the audited application paths. The
new test closes the missing deterministic farm-grant revocation race evidence.
Cross-organization request scoping, ledger integrity, source isolation and
concurrency controls are supported by direct tests and constrained database
relations/triggers.

### Medium

- Application locks coordinate participating code paths. Direct SQL, old
  binaries, maintenance jobs or external writers can bypass them. Production
  activation therefore still depends on the documented compatibility manifest,
  writer drain and write barrier.

### Low

- Deterministic lock-wait tests establish the selected interleavings and rollback
  behavior, but are not exhaustive model checking, a production load test or a
  throughput benchmark.
- Production environment values, deployed migration state, external writers,
  and hosted CI/security checks are outside local source verification.

## Corrections and scope

Only a regression test and this audit document were added. There were no
production-code changes, Prisma changes/migrations, dependency updates, sales
depletion activation, M6 financial features, M5-11 work, commits or pushes.
Production sales depletion remains disabled by default and was not enabled by
this audit.

## Concurrency verification

The focused deterministic selection passed **18 tests**, with 36 intentionally
filtered out. The selected suite uses transaction barriers and checks PostgreSQL
lock blockers. The full fulfilment integration suite passed **54 tests** in the
sequential workspace regression, including produce and poultry oversell,
fulfilment/cancellation both-winner cases, mortality/feed/stock interactions,
reversal conflicts, farm-grant revocation and outbound inventory adjustment
interactions.

Rollback assertions compare persisted batches, lines, movements/depletions,
receipts and versions before retry; mixed-source failure after earlier effects
leaves no partial batch. Competing-source tests assert one winner and a final
nonnegative derived balance/population. No timing-based test was added.

## Ledger reconciliation

- Produce POSTING lines match one negative `ISSUE` movement each; full correction
  appends a positive `ADJUSTMENT` and leaves the original movement intact.
- Poultry allocations match one immutable `FlockSaleDepletion` each; reversal
  appends the linked compensation. Mortality and starting population are not
  rewritten, and birds have no inventory item/movement.
- The `1.125` produce case verifies exact movement and reversal quantities,
  derived remaining stock and demand, and unchanged commercial snapshots.
- Full mixed-batch rollback, immutable trigger checks and commit-time cardinality
  constraints prove no partial or duplicate depletion effect in the covered
  paths.
- Orders, fulfilments and customer quantity history create no invoice, payment,
  receivable, payment allocation or persisted stock/population balance.

## Authorization assessment

Organization context is server-created from the active membership; services
scope tenant-owned queries by `organizationId`. Farm operations independently
check current role permissions and farm assignments. Fulfilment reauthorizes
inside its transaction after lock acquisition. The organization's `FOR KEY
SHARE` lock conflicts with membership/access replacement's `FOR UPDATE`, making
the two operations serializable in the tested ordering. Commercial STAFF reads
keep whole-order totals while omitting source identities. Farm event DTOs use
explicit projections and farm-scoped queries. Payload organization/farm/actor
IDs do not establish authority.

## Remaining risks and release recommendation

No local application blocker was found. **Recommendation: CONDITIONAL / locally
PR-ready**, pending hosted CI/security checks and review of this audit. The user
requested stop-before-commit/push, so no PR or hosted checks are claimed.

Do not enable production sales depletion based on this audit. The release owner
must still verify the M5-05 compatibility manifest, applied migrations, M5-LOCK
completion, compatible M5-POP/API/web/shared builds, external consumer sign-offs
and drained old writers/write barrier. Keep the writer flag off until those
deployment conditions are independently confirmed. M6 accounting and customer
returns remain outside this task.

## Verification record

All commands ran from the repository root unless stated. Disposable PostgreSQL
databases were created and dropped by the existing test harness. Redis used
`redis://127.0.0.1:6379/15` for the sequential workspace regression; browser
sessions used the E2E runner's unique key prefix. Process exit codes are recorded.

| Verification                                                                                                                | Result                                                                           | Exit |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---: |
| Focused PostgreSQL suites: fulfilments, sales orders, sales catalog, sales persistence, M3 stock/movement and M4 population | 7 files, 107 tests passed, including all new regressions                         |    0 |
| Focused deterministic concurrency: fulfilments suite, filter `serializes\|versus\|conflicts\|feed`                          | 18 passed, 36 skipped by filter                                                  |    0 |
| Real API/browser sales workflows: `playwright.sales-orders.config.ts`                                                       | 2 passed: mixed partial post/reversal and mixed order create/edit/confirm/review |    0 |
| Sequential uncached package test tasks (disposable PostgreSQL; isolated Redis DB 15)                                        | API 522 / 43 files; validation 180 / 8 files; web 138 / 17 files; **840 total**  |    0 |
| `pnpm format:check`                                                                                                         | All matched files formatted                                                      |    0 |
| `pnpm lint`                                                                                                                 | 2 tasks passed; API 0 warnings/errors                                            |    0 |
| `pnpm typecheck`                                                                                                            | 4 tasks passed                                                                   |    0 |
| `pnpm build`                                                                                                                | 4 tasks passed; API built; web/shared build tasks were served from Turbo cache   |    0 |
| `git diff --check`                                                                                                          | Passed                                                                           |    0 |

An earlier full attempt after adding the cross-organization fixture failed one
persistence test
because the new fixture used the test's deliberately reserved product code in
the foreign organization (519 passed, 1 failed; exit 1). The foreign fixture was
changed to use its own code; the complete persistence suite then passed 17/17,
followed by the passing full run. This was a test-fixture collision, not an
application failure. The concurrency selection was rerun after adding the
revocation case. The root test run
printed the existing HTTP-filter test's intentional synthetic error log
(`Database password leaked here`); that test passed after asserting the external
response does not expose it.
