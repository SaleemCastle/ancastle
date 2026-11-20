# M5-11 sales and fulfilment workflow validation

Date: 2026-11-20<br>
Branch: `m5-11/sales-workflow-validation`<br>
Scope: document the implemented M5 workflow and record local validation. No
feature code, schema, migration, deployment setting, or production depletion
gate was changed.

## Recommendation and scope

**CONDITIONAL: development complete; staging and production activation not
verified.** The actual workflow and its high-risk database behavior passed the
local disposable-database and real-API browser checks recorded below. Hosted CI,
staging deployment compatibility, external-writer sign-offs, and production
operational evidence are not available from this run. Do not enable
`SALES_FULFILMENT_ENABLED` in production on the strength of local tests.

The implementation is orders and physical fulfilment. It does not issue
invoices, collect payments, calculate accounts receivable, reconcile payments,
record customer returns, or schedule delivery. CASH/CREDIT is commercial intent;
it does not mean cash was collected or a receivable was settled.

## Implemented lifecycle

1. **Choose the customer.** Customers belong to the organization. Customer
   selection and order queries are organization-scoped and require current
   organization membership/permission. Customer identity is not farm-owned.
2. **Choose saleable products and enter line details.** `SalesProduct` is the
   organization-owned commercial definition. A PRODUCE product points to one
   organization-owned PRODUCE `InventoryItem`, and copies its exact unit. A
   POULTRY product uses `EACH` and has no inventory item. The order line captures
   product identity, description, kind, unit, ordered quantity, price and
   snapshots; price is entered on the order, not read from an inventory balance.
3. **Create and edit a draft.** Drafts can be amended with expected versions.
   `CASH` has no credit days; `CREDIT` requires the validated credit term.
   Orders belong to the organization and have no single authoritative farm.
   Line quantity is the **commercial quantity requested**, not a stock write or
   physical handover. Draft edits do not reserve any source.
4. **Snapshot commercial terms.** Initial currency is JMD. Unit prices are
   nonnegative Decimal(19,4). Each line amount is quantity Ã— unit price rounded
   half-up to two decimal places; order total is the sum of those rounded line
   amounts. Confirmation freezes customer/terms/product/quantity/price
   snapshots. The API is authoritative; a browser preview is informational.
5. **Confirm the order.** Confirmation authorizes a commercial commitment and
   freezes the order snapshot. It **does not reserve stock or birds**. Availability
   displayed before posting is a point-in-time read and can change.
6. **Select an authorized farm and eligible source for each fulfilment.** The
   caller's current farm grant and organization-specific permissions are checked
   by the API. Each command is scoped to one farm; supplying another farm requires
   another command. Produce availability is derived from that farm's M3
   movement ledger. Poultry availability is derived from M4 population and
   effective M5 sales depletion. Source identity is selected at fulfilment,
   rather than allocated by order confirmation.
7. **Post partial or complete physical fulfilment.** A posting allocates actual
   physical quantities against confirmed lines. Produce quantities retain exact
   Decimal precision and exact product/item units; poultry is positive whole
   `EACH` birds. Commercial ordered quantity and physical fulfilled quantity are
   separate. Progress is derived from posting and reversal rows; no mutable
   fulfilled-balance column is authoritative. The API rechecks line demand,
   source eligibility, current access and availability inside one transaction.
8. **Read immutable history and customer purchases.** Posting and reversal are
   separate immutable batches. Customer purchase history is net physical
   quantity: effective postings less full reversals, independently of CASH/CREDIT
   status. It does not claim paid, invoiced, delivered, or returned quantities.
9. **Correct a posting error with a full-batch reversal.** A permitted operator
   can reverse one complete original batch, at its original farm, with reason and
   the required no-handover/posting-error attestation. A reversal appends
   compensating rows; it never edits or deletes the original. Partial reversals,
   reversal-of-reversal, duplicate compensation, and customer-return workflows
   are unsupported.
10. **Cancel only remaining commercial demand.** Drafts and eligible confirmed
    orders can be cancelled once. Cancellation closes remaining demand and
    records an event; already posted physical history remains. A fully fulfilled
    order is not cancellable. Cancellation neither returns product nor reverses
    a posting. A posting-error correction after cancellation still uses the
    explicit full-batch reversal flow.

## Ownership, authorization, and source data

- **Tenant boundary:** Organization owns customers, products, orders, order
  lines, and commercial events. Tenant-owned lookups include authoritative
  `organizationId`; client-provided organization, user, role, or permission
  values never prove access.
- **Farm boundary:** Farms belong to an organization. Farm operations require a
  fresh organization membership and current farm grant (or the policy's
  organization-wide farm capability). Source and fulfilment history reads are
  farm-scoped. Services reauthorize in the transaction after lock waits, so a
  stale grant cannot authorize a new post.
- **Permissions:** Centralized role-to-permission mappings and the existing
  `AuthorizationGuard`, `FarmAccessService`, and `FarmContext` are used.
  `STAFF` has `order:read` and sees whole-order commercial totals/progress,
  including cross-farm aggregate progress. That permission does not grant
  another farm's operational source identities. Restricted details are
  redacted from organization-level commercial reads; farm source reads require
  that farm's access. STAFF is not authorized to manage/confirm/cancel orders or
  reverse fulfilment; posting still requires `fulfilment:post` and authorized
  farm access.
- **Catalog eligibility:** `SalesProduct` is not inventory. Produce links to one
  same-organization PRODUCE `InventoryItem`; the exact unit is revalidated under
  locks. Poultry uses an explicit active product/farm/flock eligibility
  association; a bird-type label does not establish eligibility. Inactive or
  closed sources cannot be newly posted, while immutable historical source
  references remain available to authorized history/reversal workflows.
- **Separate physical ledgers:** Produce POSTING writes an immutable negative M3
  `ISSUE` movement. A full correction appends a positive `ADJUSTMENT`. Poultry
  is never an `InventoryItem`: M4 starting population and mortality stay intact;
  M5 appends `FlockSaleDepletion` and reversal rows. Effective live saleable
  count is derived as starting birds minus effective mortality minus effective
  fulfilled birds. M4 mortality metrics remain based on mortality, not sales.
- **No duplicate balances:** inventory and poultry availability are sums/metrics
  derived from immutable event ledgers. Orders, fulfilments, and customer history
  create no stock balance, bird balance, invoice, payment, receivable, or paid
  amount.

## Transactions, locks, idempotency, and recovery

For posting and reversal, the service owns one READ COMMITTED PostgreSQL
transaction. Produce ISSUE/ADJUSTMENT, poultry depletion/compensation, fulfilment
header/lines, order version, and the successful command receipt commit or roll
back together. Errors propagate; the command receipt is inserted last and only a
committed success is retained. A deferred commit-time constraint checks complete
batch shape and linkage.

The canonical application lock order is **organization parent â†’ scoped command
identity â†’ order (if applicable) â†’ sorted definition rows â†’ sorted flock locks
and rows â†’ sorted stock positions**. M3 movements and M4 mortality/feed use the
shared lock protocol. Database constraints and application locks protect
participating writers; unmanaged writers still require a deployment write
barrier.

Fulfilment POST/REVERSE uses a scoped UUID idempotency key and canonical request
hash. After current authentication, permission, organization, and farm checks, a
same actor/key/payload replay returns the original receipt without a second
physical effect. Reusing the key for another payload/actor safely conflicts.
Failed transactions leave no committed receipt. If the network response is lost
after commit, replay the **same command payload and same key**, or refresh the
authoritative order/history. Do not mint a new key for an unknown outcome. Order
creation itself has no server idempotency receipt; after an uncertain create,
inspect the order list before retrying.

Direct database evidence in the M5-05/M5-10 suites covers insufficient stock or
population, concurrent source conflicts, conflicting duplicate keys, identical
key replay, stale farm-grant revocation during a posting, cancellation races,
double reversal, and injected pre-commit rollback for produce, poultry, mixed
posting, and reversal. Deterministic concurrency tests hold real transactions,
observe PostgreSQL lock waits, and then verify the winner/loser and persisted
ledgers. This proves the tested interleavings, not every possible production
schedule or behavior of writers that bypass the protocol.

## Reproducible validation

Run from the repository root on the feature branch with dependencies installed,
PostgreSQL reachable through the repository test `DATABASE_URL`, and Redis
reachable. The API integration suite creates uniquely named disposable databases
and applies committed migrations. Do not point these commands at production.

### Focused PostgreSQL tests

```powershell
pnpm --filter @ancastle/api test -- --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts src/modules/sales-orders/sales-orders.integration.spec.ts src/modules/sales-catalog/sales-catalog.integration.spec.ts src/database/sales.persistence.spec.ts src/modules/inventory/inventory-stock.integration.spec.ts src/modules/inventory/inventory-movement.persistence.spec.ts src/modules/poultry/flock-metrics.integration.spec.ts
```

Expected focused coverage: fulfilment POST/REVERSE and deterministic
concurrency; order lifecycle and tenant security; catalog source rules; sales
constraints; M3 stock; M4 population. Latest run: **7 files, 107 tests passed,
exit 0**.

### Real-API browser workflows

The existing owned-server runner creates a fresh disposable database, starts API,
auth proxy, and Next.js children, and shuts all of them down. Use a dedicated
Redis database index and opt into posting only in this test runner. The runner
sets `SALES_FULFILMENT_ENABLED=true` only for that disposable API process when
the explicit test variable is `1`; it does not change production configuration.

```powershell
$env:REDIS_URL='redis://127.0.0.1:6379/15'
$env:ANCASTLE_E2E_SALES_FULFILMENT='1'
try {
  node apps/web/e2e/run-poultry.mjs playwright.sales-orders.config.ts e2e/orders.browser.ts
  $code=$LASTEXITCODE
} finally {
  Remove-Item Env:ANCASTLE_E2E_SALES_FULFILMENT -ErrorAction SilentlyContinue
  Remove-Item Env:REDIS_URL -ErrorAction SilentlyContinue
}
exit $code
```

Latest run: **2 browser tests passed, exit 0**, zero owned servers remaining.
The mixed fulfilment/reversal test exercised desktop and 390Ã—844 mobile views,
an assigned source and an unassigned-farm denial, 1.250 KG produce with exact
ISSUE/ADJUSTMENT ledger values, whole-EACH poultry depletion/reversal, customer
net purchase history, immutable batch history, and a simulated lost response
followed by same-key replay. The order workflow test exercised create, edit,
confirm, review, CASH/CREDIT validation, and commercial snapshots. Existing
browser assertions query persisted database rows as well as the HTTP/UI results.

### Full workspace and quality gates

The full sequential regression uses the existing ignored local harness, which
creates and drops a fresh temporary database. Redis DB 15 is isolated from other
logical Redis databases; the browser runner additionally uses unique session
prefixes.

```powershell
$env:REDIS_URL='redis://127.0.0.1:6379/15'
try {
  node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-05-verify.mts root
  $code=$LASTEXITCODE
} finally { Remove-Item Env:REDIS_URL -ErrorAction SilentlyContinue }
exit $code

pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Latest sequential regression: API **522/43 files**, shared validation
**180/8 files**, web **138/17 files**, **840 total**, exit 0. All five Turbo
tasks succeeded. Existing Turbo warnings note that test tasks produce no cache
output files; they did not fail the run. `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, and `pnpm build` each exited 0. Build tasks were reported as
Turbo cache hits; the recorded output includes the successful Next production
route build. `git diff --check` must be rerun after this report is added.

### Evidence matrix

| Invariant                                                                      | Direct evidence                                                                        | Latest result                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tenant/farm authorization; payload IDs cannot spoof access                     | PostgreSQL/API authorization and fulfilment suites; browser unassigned-farm denial     | Direct; passed                                                                |
| STAFF commercial progress with restricted operational sources                  | Sales-orders and fulfilment PostgreSQL/API tests                                       | Direct; passed                                                                |
| CASH/CREDIT, JMD snapshots, Decimal(19,4), half-up line totals                 | Shared validation, sales orders, persistence, browser order flow                       | Direct; passed                                                                |
| Order confirmation does not reserve physical availability                      | Order/fulfilment contracts and the post-time authoritative checks                      | Direct in API/integration behavior; browser runs post only through fulfilment |
| Produce exact Decimal and M3 ISSUE/full correction                             | PostgreSQL persistence/API plus browser DB and history assertions                      | Direct; passed                                                                |
| Whole-EACH poultry and M5 population depletion/full correction                 | M4 population and fulfilment PostgreSQL tests plus browser DB assertions               | Direct; passed                                                                |
| Immutable posting/reversal and customer net purchase history                   | Persistence constraints, fulfilment integration, customer history API, browser history | Direct; passed                                                                |
| Insufficient availability and transaction rollback                             | PostgreSQL fulfilment/API injected-failure tests                                       | Direct; passed                                                                |
| Concurrent stock/flock conflicts and canonical lock order                      | Deterministic PostgreSQL lock-wait tests                                               | Direct for selected schedules; passed                                         |
| Stale farm permission and revoked replay                                       | PostgreSQL integration transaction barriers                                            | Direct; passed                                                                |
| Duplicate key, unknown post-commit response and safe replay                    | API receipt tests plus browser proxy fault injection                                   | Direct; passed                                                                |
| Desktop/mobile browser behavior                                                | Real API browser flow; mobile viewport 390Ã—844                                        | Direct; passed                                                                |
| Hosted CI, staging compatibility, external writers, production backup/recovery | Not exercised by local test run                                                        | No direct evidence                                                            |

## Findings and limitations

- **High operational blocker â€” production activation:** no production or staging
  migration state, deployment build compatibility, signed M5-05 manifest,
  external-writer inventory/sign-offs, old-writer drain, write-pause evidence,
  or backup/recovery drill was supplied or observed. The runtime gate checks
  only an exact server environment flag; it does not prove those conditions.
- **Medium operational limit â€” unmanaged writers:** application serialization
  cannot protect raw SQL or legacy writers that bypass it. The deployment write
  barrier is mandatory during schema/contract cutover and activation.
- **Medium scope limit â€” unknown order-create outcome:** order creation has no
  idempotency receipt. UI recovery directs the operator to inspect the list
  before retrying; this is distinct from the safe same-key fulfilment replay.
- **M6 boundary:** invoices, payments, accounts receivable, credit balances,
  reconciliation, customer returns, and delivery logistics remain unimplemented.
- No defect was found in the covered local workflow. Tests do not certify
  production configuration, unmanaged integrations, all concurrent schedules,
  or hosted CI.

## References

- [M5-01 architecture ADR and rollout addenda](m5-01-sales-fulfilment-architecture.md)
- [M5-05 atomic fulfilment and deployment gate](m5-05-atomic-order-fulfilment.md)
- [M5-05 final audit](m5-05-final-audit.md)
- [M5-10 integrity audit and coverage matrix](m5-10-sales-integrity-audit.md)
- [M5-08 order management UI](m5-08-sales-order-management-ui.md)
- [M5-09 fulfilment/history UI](m5-09-fulfilment-sales-history-ui.md)
- [M5-06 CASH/CREDIT terms](m5-06-cash-credit-sale-terms.md)
- [M5-07 customer purchase history](m5-07-customer-order-purchase-history.md)
- [M5-CAT catalog](m5-cat-sales-catalog.md), [M5-LOCK lock protocol](m5-lock-mutation-locking.md), and [M5-POP population](m5-pop-sales-aware-population.md)
- [M1 organization/farm workflow](m1-workflow.md), [M4 poultry workflow](m4-workflow.md), [M3 inventory foundation](../README.md#m3-inventory-foundation)
- [Central permissions](../apps/api/src/modules/authorization/role-permissions.ts), [farm access](../apps/api/src/modules/authorization/farm-access.service.ts), [lock protocol](../apps/api/src/database/mutation-locks.ts), and [fulfilment gate](../apps/api/src/modules/fulfilments/fulfilment-activation.service.ts)
- [Trello M5-11 acceptance criteria](https://trello.com/c/4Iu26icT/75-m5-11-document-and-validate-sales-and-fulfilment-workflow)
