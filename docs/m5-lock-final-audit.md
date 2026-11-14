# M5-LOCK final concurrency and deployment audit

Audit date: 2026-11-14. Branch: `m5-lock/shared-mutation-locking`.
Scope: source review against the approved M5-01 ADR and
`docs/m5-lock-mutation-locking.md`, including focused verification of defects
found during review. No commit, push, sales posting or M5-CAT work is authorized.

All source references below are repository-relative, with exact starting lines.
They refer to the final working tree, including the corrections described below.

## Corrections made during this audit

Both posting forms previously recomputed the hidden expected unit from new props
on every render. A soft navigation can refresh item definitions while preserving
the entered quantity. This could silently reinterpret that quantity after a legal
unit edit on an unused item. The forms now capture the unit when the user selects
the item and retain it until another selection or a successful reset:

- `apps/web/components/inventory/movement-form.tsx:66`, hidden field at line 94.
- `apps/web/components/flocks/posting-form.tsx:39`, hidden field at line 78.
- Regression: `apps/web/e2e/poultry.browser.ts:254` refreshes real server props
  through history pagination after an API unit edit, retains the quantity and
  original expected unit, submits, and checks that no movement was posted.

Two test schedules also needed stronger evidence. The opposing-plan case used
`Promise.all` without proving blocking; the stale-feed-unit case was sequential.
Both now use the controlled transaction/blocking helper. No production locking,
accounting, schema or migration change was needed during this audit.

## Mutation inventory and transaction boundaries

Notation: O = Organization; D = definitions; F = flock advisory then scoped row
FOR UPDATE; S = existing stock advisory; E = checks and effects. Every lock lives
until its owning transaction ends. SHARE and UPDATE mean PostgreSQL row locks.
Command and Order stages do not apply to any current M3/M4 writer.

| Method and source                                                                                      | Transaction boundary                                                                                | Exact applicable order                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| InventoryItemsService.create, `apps/api/src/modules/inventory/inventory-items.service.ts:119`          | Own interactive transaction, line 124; database default isolation                                   | O UPDATE at 127; code allocation; E insert. New item has no existing definition to lock.                                                                                                                             |
| InventoryItemsService.update, same file:166                                                            | Own READ COMMITTED transaction, lines 172 and 251                                                   | O KEY SHARE; D Item UPDATE at 174; re-read item and all scoped dependencies at 177/188; E update at 230.                                                                                                             |
| InventoryItemsService.deactivate/reactivate/private setActive, same file:258/265/272                   | Both public methods delegate to the single READ COMMITTED transaction at 277/299                    | O KEY SHARE; D Item UPDATE at 279; E scoped lifecycle update at 282.                                                                                                                                                 |
| InventoryStockService.postMovement, `apps/api/src/modules/inventory/inventory-stock.service.ts:102`    | Own READ COMMITTED transaction at 106/108                                                           | Delegates once to the following helper; no separately committed effects.                                                                                                                                             |
| InventoryStockService.postMovementInTransaction, same file:116                                         | Caller-owned transaction; READ COMMITTED and full rollback required by contract at 112              | O KEY SHARE; D Farm SHARE then Item SHARE at 128; S; revalidate ownership/unit at 134/139; stock sum at 154; E movement insert at 176. A composed caller must preplan the entire superset.                           |
| FeedUsageService.post, `apps/api/src/modules/poultry/feed-usage.service.ts:32`                         | Own READ COMMITTED transaction, 38/95                                                               | O KEY SHARE; D Farm SHARE, Item SHARE; F; S, all planned at 40; eligibility at 45/46/55; E helper ISSUE at 66 then linked FeedUsage at 80.                                                                           |
| FeedUsageService.reverse, same file:103                                                                | Own READ COMMITTED transaction, 110/185                                                             | Nonlocking scoped immutable-source discovery at 113; O KEY SHARE; D Farm SHARE, Item SHARE; F; S at 122; recheck farm/reversal at 129/131; locked unit at 145; E helper ADJUSTMENT at 155 then full reversal at 169. |
| MortalityService.post, `apps/api/src/modules/poultry/mortality.service.ts:30`                          | Own READ COMMITTED transaction, 45/81                                                               | O KEY SHARE; D Farm SHARE; F via wrapper at 47; E authorized flock, effective mortality, guard and event insert at 48/56/67. No stock.                                                                               |
| MortalityService.reverse, same file:88                                                                 | Own READ COMMITTED transaction, 96/130                                                              | O KEY SHARE; D Farm SHARE; F at 98; E authorized source lookup and compensating event insert at 100/115. No stock.                                                                                                   |
| FlocksService.create, `apps/api/src/modules/poultry/flocks.service.ts:152`                             | Preliminary authorization read, then own interactive transaction at 158; database default isolation | O UPDATE; D Farm SHARE at 160; revalidate farm at 164; code allocation; E insert at 197. New flock needs no existing flock lock.                                                                                     |
| FlocksService.update, same file:213                                                                    | Own READ COMMITTED transaction, 219/286                                                             | O KEY SHARE; D Farm SHARE; F at 223; E merged validation, unchanged mortality baseline guard at 249, scoped update at 260.                                                                                           |
| FlocksService.setActive, same file:290                                                                 | Own interactive transaction at 296; database default isolation                                      | O KEY SHARE; D Farm SHARE; F at 297; E authorized read and scoped lifecycle update at 301. Close/reactivate controllers delegate here.                                                                               |
| FarmInventoryController.postMovement, `apps/api/src/modules/inventory/farm-inventory.controller.ts:67` | Adapter; stock service owns transaction                                                             | Verified context and validated expected unit forwarded at 76.                                                                                                                                                        |
| FlocksController.postMortality/postFeed, `apps/api/src/modules/poultry/flocks.controller.ts:161/191`   | Adapters; corresponding domain service owns transaction                                             | Shared validated contracts, authoritative context, same input spread at 170/200; no separate ledger write.                                                                                                           |

Read-only stock, history, metrics and list methods are not mutation entry points.
`lockFlockMutation` delegates to the shared helper at
`apps/api/src/modules/poultry/flock-mutation-lock.ts:14`. Source search found no
additional production M3/M4 ledger insert path outside the services above.
Creation and flock lifecycle methods retain their existing default-isolation
choice; PrismaService does not override the database default
(`apps/api/src/database/prisma.service.ts:24`). Deployment must retain READ
COMMITTED for participating writers. Production database settings were not read.

## Required checks

| #   | Result                                          | Exact source and supporting evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Remaining risk                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PASS                                            | Complete method/transaction inventory above; matches ADR method inventory at `docs/m5-01-sales-fulfilment-architecture.md:490`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Default-isolation entry points depend on database configuration; internal helper callers must honor the documented transaction contract.                                                                                                                |
| 2   | PASS                                            | ADR stages at `docs/m5-01-sales-fulfilment-architecture.md:624`; `apps/api/src/database/mutation-locks.ts:110` acquires O, optional command (114), optional Order (119), definitions (124), flocks (135), stock (144), then returns for effects.                                                                                                                                                                                                                                                                                                                                                      | Command/Order code is dormant and has no production fulfilment caller or runtime coverage in this ticket.                                                                                                                                               |
| 3   | PASS                                            | Fixed definition table order at `apps/api/src/database/mutation-locks.ts:5`; lowercase normalization at 28; definitions sort at 127, flock sort at 135, stock sort at 144. Opposing-plan and three-party cases at `apps/api/src/database/mutation-locks.integration.spec.ts:396/339`.                                                                                                                                                                                                                                                                                                                 | Multi-flock and cross-farm sorting are source-verified, not independently exercised by these single-flock tests.                                                                                                                                        |
| 4   | PASS                                            | Feed post/reverse complete plans at `apps/api/src/modules/poultry/feed-usage.service.ts:40/122`; helper refuses late expansion at `apps/api/src/database/mutation-locks.ts:95`; three-party blocker and advisory probe at `apps/api/src/database/mutation-locks.integration.spec.ts:339/380`.                                                                                                                                                                                                                                                                                                         | An unmanaged SQL writer or future service can violate the protocol; those writers must remain barred.                                                                                                                                                   |
| 5   | PASS                                            | Exclusive item lock precedes dependency reads and update at `apps/api/src/modules/inventory/inventory-items.service.ts:174/188/230`. Movement/feed use Item SHARE. Catalog-first/edit-first tests at `apps/api/src/database/mutation-locks.integration.spec.ts:435/489` exercise shared catalog locks and M5-03 trigger revalidation. No active/farm restriction releases history protection.                                                                                                                                                                                                         | Catalog service is deliberately absent. Future create/relink/confirm paths must take the same SHARE lock. M5-03 triggers alone do not replace that protocol.                                                                                            |
| 6   | PASS                                            | `apps/api/src/modules/inventory/inventory-stock.service.ts:139/146` reads and compares unit after the complete lock prefix, before balance/write; feed forwards it at `apps/api/src/modules/poultry/feed-usage.service.ts:72`, reversal derives it at 145/161. Stable 409 INVENTORY_DEFINITION_CHANGED. Tests at `apps/api/src/database/mutation-locks.integration.spec.ts:178/466`.                                                                                                                                                                                                                  | No unit conversion; existing movement history lacks original-unit snapshots.                                                                                                                                                                            |
| 7   | PASS, defect corrected                          | Required enums at `packages/validation/src/index.ts:284/312`; V2 aliases at 358/359 accept the identical required shape. Controller at `apps/api/src/modules/inventory/farm-inventory.controller.ts:76`; flock spread at `apps/api/src/modules/poultry/flocks.controller.ts:200`; actions at `apps/web/app/app/inventory/stock/actions.ts:15` and `apps/web/app/app/flocks/actions.ts:85`; selection snapshots and browser regression above. Missing-field/action tests at `apps/web/lib/management/inventory-actions.test.ts:264`, shared schemas at `packages/validation/src/inventory.spec.ts:11`. | Old tabs and external callers must be refreshed/upgraded. No optional-unit/default-unit fallback exists. Browser regression directly covers the inventory form; feed form uses the same corrected selection pattern and existing feed workflow.         |
| 8   | PASS after test corrections                     | All 11 cases enumerated below. Every case now waits for independent PostgreSQL blocking before release, via helpers at `apps/api/src/database/mutation-locks.integration.spec.ts:113/139/151/238`, or the explicit three-party schedule at 339.                                                                                                                                                                                                                                                                                                                                                       | Test-owned transactions represent catalog/composed operations, not future sales APIs. Sequential follow-on assertions are identified below.                                                                                                             |
| 9   | PASS                                            | No exception is swallowed inside the owning mutation transaction. Unit/category/deactivation failures assert unchanged ledgers in the focused suite. Injected post-INSERT FeedUsage failure at `apps/api/src/modules/poultry/feed-usage.integration.spec.ts:232` proves ISSUE rollback. Existing insufficient-stock test at `apps/api/src/modules/inventory/inventory-stock.integration.spec.ts:155`; unique full compensation at `apps/api/src/modules/poultry/feed-usage.integration.spec.ts:350`.                                                                                                  | Generic database/network timeout or commit-outcome ambiguity still requires caller reconciliation; M3/M4 do not gain M5 idempotency in this ticket. Savepoint recovery/reuse is expressly unsupported.                                                  |
| 10  | PASS source policy; NOT VERIFIED deployed state | `docs/m5-lock-mutation-locking.md:127` requires M5-03 first, pause/drain all writers, coordinated API/contracts/web update, then upgraded writers only. `apps/api/src/modules/inventory/inventory-items.service.ts:202/209` really queries M5-03 tables. M5-03 guards at `apps/api/prisma/migrations/20261113160000_sales_persistence/migration.sql:551/609` remain intact. Fresh deployment and populated-M4 upgrade tests are at `apps/api/src/database/sales.persistence.spec.ts:506/539`. Rollback preserves schema/history and disables legacy definition edits.                                 | This is an operational barrier, not an implemented feature flag. Actual drain, external caller inventory, production migration state and rollback exercise are not verified. Local development database still has M5-03 pending and was left untouched. |
| 11  | PASS                                            | `apps/api/src/modules/poultry/flock-metrics.ts:80` remains S minus effective mortality; `apps/api/src/modules/poultry/mortality.service.ts:56` and `apps/api/src/modules/poultry/flocks.service.ts:249` retain existing guards. No diff in metrics/history calculation, schema, committed migration or sales posting service. Regression cases at `apps/api/src/modules/poultry/flock-metrics.integration.spec.ts:119/219`.                                                                                                                                                                           | Existing M4 readers must not coexist with active sales depletion. CAT, POP and fulfilment posting remain later prerequisites.                                                                                                                           |
| 12  | PASS: gaps identified                           | See uncovered scenarios below; matching limits are stated in `docs/m5-lock-mutation-locking.md:158`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Source review and 11 controlled cases cannot prove absence of every PostgreSQL deadlock or operational rollout failure.                                                                                                                                 |

## All 11 focused cases

File: `apps/api/src/database/mutation-locks.integration.spec.ts`. Each row's
starting line identifies its complete test. `ordered` starts an independent
transaction while the holder remains open and asserts `pg_blocking_pids` before
release. `duringFeed` calls the real stock helper and pauses after its real
INSERT, before the real FeedUsage INSERT, while a competitor blocks. There are no
scheduling sleeps. The three-party case additionally identifies its waiter PID.

| Case / line | Overlap and invariant                                                                                                                                                                                 | Limitation                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / 178     | Unit-edit holder blocks real movement; stale unit fails; stock remains zero.                                                                                                                          | Winning edit uses a test-owned transaction with the production plan.                                                                                |
| 2 / 196     | Real movement helper is held open while actual item update blocks; history freezes unit.                                                                                                              | Inactive correction and movement-only category checks afterward are sequential regressions.                                                         |
| 3 / 217     | Category edit blocks actual feed; feed rechecks FEED eligibility; no usage or ISSUE.                                                                                                                  | Winning edit is test-owned.                                                                                                                         |
| 4 / 272     | Real feed ISSUE remains uncommitted while actual category update blocks; later update sees FeedUsage.                                                                                                 | Closed/inactive full reversal and post-reversal protection afterward are sequential.                                                                |
| 5 / 295     | Deactivate-first blocks feed; feed-first blocks actual deactivate through duringFeed.                                                                                                                 | Standalone inactive M3 correction is a sequential policy assertion.                                                                                 |
| 6 / 321     | Feed holds locks and real ISSUE while flock close transaction blocks on shared flock protocol.                                                                                                        | Close-first rejection is sequential; close writer uses the production wrapper and test-owned update.                                                |
| 7 / 339     | Flock/PRODUCE holder blocks actual feed; composed FEED/PRODUCE transaction owns FEED stock and waits on PRODUCE. Advisory probe confirms ownership, all complete after release with correct balances. | Simulates future mixed source composition without implementing a sales service.                                                                     |
| 8 / 396     | First complete multi-item plan holds real effects while reversed-input second plan demonstrably blocks; both finish with exact stock.                                                                 | Does not force a pause between individual definition locks; sort order is also directly reviewed in source. Late expansion rejection is sequential. |
| 9 / 435     | Shared item lock and first inactive catalog insert block actual definition edit; post-wait dependencies freeze it.                                                                                    | Metadata/lifecycle follow-ons are sequential. No catalog API is added.                                                                              |
| 10 / 466    | Manual ISSUE holder blocks stale-unit feed on stock; only manual ISSUE commits, no FeedUsage or second ISSUE.                                                                                         | This was sequential before the audit correction.                                                                                                    |
| 11 / 489    | Exclusive definition edit blocks first catalog link; after waiting, M5-03 trigger rejects stale unit/category; no product persists.                                                                   | Test-owned catalog transaction, not future CAT controller coverage.                                                                                 |

## Uncovered deadlock, isolation and rollout scenarios

- Future command identity/Order locking, cross-order and cross-farm fulfilment,
  multiple flocks, duplicate plan modes and complete sales failure/retry flows
  need their owning tickets' tests. No sales writer is activated here.
- Feed reversal racing a new feed/manual issue and simultaneous duplicate
  reversal are not independently barrier-controlled in this suite. They use the
  same complete prefix and unique reversal guard; existing sequential reversal
  and concurrent consumption tests do not prove every reversal schedule.
- Parent code allocation versus source writers, farm lifecycle versus mutations,
  organization lifecycle/permission revocation, and shared-reader starvation
  under a sustained stream of exclusive edits are not stress-tested here.
- Prepared-plan transaction identity prevents extension or lock upgrade; rollback
  to savepoint could invalidate held-lock bookkeeping. No current caller uses
  that recovery pattern; whole-operation rollback is required.
- Explicit READ COMMITTED is used for quantity/dependency decisions. A deployment
  changing default isolation or a future caller using a pre-lock REPEATABLE READ
  snapshot must be reviewed. Production isolation and pool configuration are not
  established by local tests.
- Existing 32-bit advisory hashes can collide and cause extra serialization;
  PostgreSQL can still detect deadlocks involving other tables or unmanaged
  writers. This ticket adds no general retry loop or timeout policy.
- The write barrier is manual. A rolling deployment mixing old and new API
  writers is unsafe even if the new web sends expected units. Old internal
  writers bypass both the lock prefix and unit check. Keep writes paused through
  rollback, preserve additive M5-03 objects, and keep legacy definition changes
  disabled. Legacy unit meaning must be reviewed before catalog activation.

## Verification and recommendation

All verification used the existing pinned tools. Database tests ran against
owned disposable PostgreSQL databases with the committed migration chain. The
configured development database and committed migrations were left unchanged.

| Check                                                                                                          | Final result                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                            | PASS                                                                                                                          |
| `pnpm lint`                                                                                                    | PASS                                                                                                                          |
| `pnpm typecheck`                                                                                               | PASS                                                                                                                          |
| `pnpm test -- --maxWorkers=2`                                                                                  | PASS: API 439/40 files, web 110/12 files, validation 176/8 files; all five Turbo tasks succeeded                              |
| Independent focused locking suite, `vitest run src/database/mutation-locks.integration.spec.ts --maxWorkers=2` | PASS: 11 tests, 1 file; real independent PostgreSQL transactions                                                              |
| `pnpm build`                                                                                                   | PASS                                                                                                                          |
| `git diff --check`                                                                                             | PASS                                                                                                                          |
| Browser workflow and soft-refresh regression, `node e2e/run-poultry.mjs` in `apps/web`                         | PASS: 3 cases, exit 0; Windows server shutdown required stopping the three test-owned server processes                        |
| M5-03 migration compatibility                                                                                  | PASS: full suite includes fresh Prisma migrate deploy, schema sync and populated-M4 upgrade in all 16 sales persistence tests |

The standard full test command was invoked through an ignored disposable-database
harness; logs confirmed `turbo run test -- --maxWorkers=2` and each
`vitest run --maxWorkers=2`. Validation's existing discovery runs both source and
built specs, hence the 176 count. CI and production deployment were not run.

Earlier runs remain relevant evidence of runner sensitivity: the implementation
was successfully verified with `pnpm test --concurrency=1 -- --maxWorkers=2`.
Earlier ordinary parallel runs hit the existing 10,000 ms afterAll database DROP
limit. During this audit, a combined 19-case locking/feed run alongside browser
verification passed every assertion but both suites exceeded that same teardown
limit. The subsequent standard full run passed with no timeout, assertion or
fixture-protection changes. Browser assertions all passed; stopping only the
three owned API/proxy/web servers resolved a Windows shutdown stall, after which
the runner completed and disposed its database successfully. Neither observation
is evidence of a production lock-order failure, but both are local test-harness
risks and must not be concealed as initially green runs.

Recommendation: **SAFE TO MERGE**, subject to the repository's normal CI review.
The audited source checks pass after the narrow corrections. This recommendation
does not verify deployment execution: apply M5-03, pause and drain old writers,
coordinate all contracts/API/web callers, and preserve the documented rollback
barrier before resuming writes. Multi-flock, reversal-race and future sales command
coverage remain the explicit limits above. No commit, push or M5-CAT work was done.
