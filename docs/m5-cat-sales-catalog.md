# M5-CAT sales catalog and poultry source eligibility

Implements [M5-CAT](https://trello.com/c/V8r4DulU) on
`m5-cat/sales-product-catalog`, using the approved M5-01 ADR, M5-02 wire contracts,
M5-03 persistence and M5-LOCK protocol. The card and all three dependencies were
read; the card is In Progress and the dependencies are Done.

Catalog definitions identify what can be sold and which flocks may supply it.
They never reserve supply, post a movement, create depletion or alter population.
No Prisma schema or migration change is required.

## Routes and authorization

Routes below are under `/api/organizations/:organizationId`. All require the
existing AuthGuard and fresh organization membership/permission checks.

| Method | Route                                                                           | Permissions and behavior                                                                                      |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/sales-products`                                                               | `sales-product:read`; bounded code/name search, kind, active-state and pagination filters                     |
| POST   | `/sales-products`                                                               | `sales-product:manage`; shared typed create input, server-owned PRD code, organization, unit and active state |
| GET    | `/sales-products/:productId`                                                    | `sales-product:read`; M5-02 product definition, with no farm associations, operational counts or balances     |
| PATCH  | `/sales-products/:productId`                                                    | `sales-product:manage`; name and explicit permitted source definition change                                  |
| POST   | `/sales-products/:productId/deactivate`                                         | `sales-product:manage`; empty strict command; retains all history                                             |
| POST   | `/sales-products/:productId/reactivate`                                         | `sales-product:manage`; empty strict command; revalidates a linked produce definition                         |
| GET    | `/farms/:farmId/sales-products/:productId/poultry-sources`                      | `sales-product:read`, `flock:read`, verified active farm access; only this farm's bounded associations/counts |
| POST   | `/farms/:farmId/sales-products/:productId/poultry-sources`                      | `sales-product-source:manage`, `flock:read`, verified farm access; strict `{ flockId }` selector              |
| POST   | `/farms/:farmId/sales-products/:productId/poultry-sources/:sourceId/deactivate` | Same management/farm requirements; strict empty command                                                       |
| POST   | `/farms/:farmId/sales-products/:productId/poultry-sources/:sourceId/reactivate` | Same management/farm requirements; validates product/flock eligibility on a transition to active              |

OWNER, ADMIN and MANAGER receive all three catalog permissions. STAFF receives
catalog read only. Existing farm access remains independent: MANAGER/STAFF need
active assignments, while existing FARM_ACCESS_ALL policy applies to administrators.
Produce linking/relinking and activation additionally require `inventory:read`.
No catalog permission grants inventory posting or flock-definition management.

Product queries accept `search`, `kind`, `isActive`, `page` and `pageSize`.
Association queries accept `isActive`, `page` and `pageSize`. The existing bounded
pagination contracts apply: page 1..1,000,000, page size 1..100, default size 20.
Search is limited to 120 characters. Filtering happens before counts/pagination;
list/count share a REPEATABLE READ snapshot with deterministic ordering.

The existing inventory-item list gains an optional strict `category` filter.
The produce selector requests `category=PRODUCE&isActive=true` with bounded pages
and search, instead of downloading all inventory or filtering after pagination.
Existing callers without this optional filter retain their behavior.

## Definitions and lifecycle

- POULTRY is always server-assigned EACH, with no inventory item. Flock bird type
  and maturity labels do not determine eligibility. No new health, maturity or
  available-bird threshold is introduced.
- PRODUCE requires an active same-organization PRODUCE item and the exact observed
  `expectedInventoryUnit`. Unit comes from the locked definition, not an independent
  client product-unit field. The catalog can exist with zero stock.
- Pre-reference source changes use the shared atomic `definition` input. Any
  non-draft order-line reference or any poultry association, including an inactive
  association, freezes kind/unit/item identity, matching the M5-03 database guards.
  Name and active lifecycle remain editable without rewriting commercial snapshots.
- An attached pair is unique by organization/product/farm/flock. Attaching an
  already-active pair returns its existing identity, including when its effective
  eligibility has subsequently become false. An inactive pair requires explicit
  reactivation. Lifecycle retries retain identity; an already-stored desired source
  state succeeds. A transition from inactive to active requires active product/flock.
- Source identity and creator attribution cannot be patched or reparented. No
  DELETE or source PATCH API exists. Source commands constrain ID, organization,
  product and farm together; the original flock identity is immutable in PostgreSQL.
- Effective eligibility is derived from association/product/flock active states
  within an authorized active farm. Closed flocks or inactive products do not erase
  associations. Deactivation remains possible for ineffective associations.

Stable safe errors include `SALES_PRODUCT_NOT_FOUND` and
`POULTRY_SOURCE_NOT_FOUND` (404), and the following conflicts (409):
`SALES_PRODUCE_SOURCE_INELIGIBLE`, `INVENTORY_DEFINITION_CHANGED`,
`SALES_PRODUCT_DEFINITION_FROZEN`, `SALES_PRODUCT_KIND_MISMATCH`,
`POULTRY_SOURCE_INACTIVE`, `POULTRY_SOURCE_INELIGIBLE`, and `CONCURRENT_UPDATE`.
Invalid request shapes use existing field-level VALIDATION_ERROR responses;
permission/farm denial uses existing FORBIDDEN behavior. Cross-tenant selectors
never establish authorization or reveal another farm's source names/counts.

## Transactions and locks

Every mutation owns one READ COMMITTED transaction and uses `lockMutation`:

| Mutation                 | Applicable canonical prefix, before checks/effects                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Product create           | Organization UPDATE for code allocation, then InventoryItem SHARE for produce                                                             |
| Product update/lifecycle | Organization KEY SHARE; SalesProduct UPDATE; old and requested InventoryItems SHARE, sorted by the shared planner                         |
| Attach flock             | Organization KEY SHARE; Farm SHARE; SalesProduct SHARE; existing flock advisory key then scoped Flock UPDATE                              |
| Source lifecycle         | Organization KEY SHARE; Farm SHARE; SalesProduct SHARE; PoultryProductSource UPDATE; existing flock advisory key then scoped Flock UPDATE |

Unused command, Order and stock stages are omitted. No catalog mutation takes a
stock lock. No earlier-stage lock is acquired after a later-stage lock.

Product mutations discover the scoped item identity before planning, then re-read
under the full prefix. A concurrent definition change during that discovery
returns CONCURRENT_UPDATE; the service never extends its prepared plan after
locking. Source lifecycle discovery reads only the immutable original flock ID.
Farm access and product/flock eligibility are checked after locks. Reference
guards read dependencies without taking late Order or Product locks.

Inventory definition editors and consumers retain M5-LOCK's shared/exclusive item
protocol. A new catalog reference cannot race a successful incompatible unit or
category edit. Product/source locks also serialize lifecycle and kind changes
against association management. M5-03 constraints remain the final integrity layer.

List queries use bounded Prisma projections and relation loading, with no
per-product or per-source query loop. Organization catalog DTOs preserve M5-02's
minimal contract. The UI resolves readable produce code/name/unit through the
existing authorized inventory detail API; the list links to that item directly.
Farm operational associations are never nested in the organization catalog DTO.

## Management UI

`/app/sales-products`, `/new`, `/:productId`, and `/:productId/edit` use the
existing ApplicationShell, management components and authenticated server actions.
The list offers code/name search, kind/lifecycle filtering and bounded pagination.
Create/edit forms use shared Zod contracts and an explicit source-change control;
ordinary renames cannot silently retarget the source. Produce choices show their
verified unit, with bounded search/pages. The observed unit is captured at item
selection and retained across refreshed props, without automatic conflict retries.

Poultry details load sources only after an accessible farm is selected. Active
flock choices are bounded, searchable and restricted to that farm. Associations
display both stored lifecycle and reasons for ineffective eligibility. STAFF can
read permitted-farm eligibility but receives no management controls. API guards
and server actions enforce the same permissions independently of the UI.

Farm selectors submit a fresh scoped page request. Source forms are keyed by
organization/farm/product/source identity so another context cannot retain old
choices, action state or hidden selectors. Organization switches return to the
new organization's catalog. Revoked/invalid farm context replaces source content
with the existing workspace-unavailable state. API requests use existing no-store
management fetches and fresh application context, not persisted browser grants.

Loading, empty, field validation and safe service-error states follow existing
management conventions. Browser verification covers narrow/mobile rendering as
well as real API-backed changes and source redaction.

## Deployment and rollback

1. Apply M5-03 and complete M5-LOCK's coordinated contract/write-barrier cutover
   across all API/web instances, workers, scripts and external M3/M4 writers.
   Read-only catalog code must not be used to infer that legacy writers are safe.
2. Verify legacy unit meaning before allowing the first catalog association.
   Existing inventory history has no original-unit snapshot; no conversion or
   historical balance backfill is introduced here.
3. Deploy the catalog API, centralized permissions and UI together, then verify
   both product kinds, farm scope, unit conflicts and lifecycle before opening
   catalog management. This implementation performs no deployment.
4. Rollback can remove the CAT API/UI while retaining M5-03 data and M5-LOCK-aware
   writers. Preserve catalog/source rows and referenced identities. Do not roll
   back to writers that bypass definition locks/reference guards; pause and drain
   affected writers and repair forward if their compatibility is uncertain.
5. M5-POP and future order/fulfilment tickets still need their own reviewed rollout.
   Sales depletion and population-v2 must remain inactive. M4 population continues
   to use starting birds minus effective mortality.

The barrier is operational, not an added feature flag. Production migration
state, writer drain and rollback execution are not established by local tests.

## Verification

All checks below were run on `m5-cat/sales-product-catalog` on 2026-11-14.

| Check                   | Command/configuration                                                                                                                                                                               | Result                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Catalog API integration | `node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-lock-audit-verify.mts focused src/modules/sales-catalog/sales-catalog.integration.spec.ts`               | PASS: 1 file, 13 tests                                                                                          |
| Controlled concurrency  | `node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-lock-audit-verify.mts focused src/modules/sales-catalog/sales-catalog.integration.spec.ts -t concurrent` | PASS: 4 tests; 9 non-concurrency tests intentionally filtered                                                   |
| Catalog server actions  | `pnpm --filter @ancastle/web exec vitest run lib/management/sales-catalog-actions.test.ts --maxWorkers=2`                                                                                           | PASS: 1 file, 6 tests                                                                                           |
| Browser workflows       | From `apps/web`: `node e2e/run-poultry.mjs playwright.catalog.config.ts`                                                                                                                            | PASS: 2 browser tests; see evidence below                                                                       |
| Full regression suite   | `node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-lock-audit-verify.mts full`                                                                              | PASS: underlying `pnpm test -- --maxWorkers=2`; API 452/41 files, web 116/13, validation 178/8; 746 tests total |
| Formatting              | `pnpm format:check`                                                                                                                                                                                 | PASS                                                                                                            |
| Lint                    | `pnpm lint`                                                                                                                                                                                         | PASS: API 0 warnings/0 errors; web, types and validation tasks successful                                       |
| TypeScript              | `pnpm typecheck`                                                                                                                                                                                    | PASS: all 4 workspace tasks successful                                                                          |
| Production build        | `pnpm build`                                                                                                                                                                                        | PASS: all 4 workspace tasks successful; Next.js compiled and generated all 33 static pages                      |
| Whitespace              | `git diff --check`                                                                                                                                                                                  | PASS (after final documentation update)                                                                         |

The full-suite wrapper creates and later disposes its own temporary PostgreSQL
database, sets that database URL for the normal root `pnpm test -- --maxWorkers=2`
command, and does not reset or write to the configured development database.
The focused API and concurrency commands use the same disposable-database helper.

The browser runner uses the real Next application, API, and disposable PostgreSQL
fixture, not a mock catalog API. The management workflow passed on a 390px
viewport and verified required-name browser validation, PRODUCE-only active
inventory choices, displayed/matched KG unit, create/edit, deactivate/reactivate,
POULTRY creation, farm-scoped flock attach/deactivate/reactivate, farm switching
with old source names absent, and bounded list pagination/kind filtering. The
STAFF workflow passed with catalog read access and no edit/lifecycle/attach
controls; it verified an unassigned farm's source was absent, organization
switching cleared prior product/source content, revoked farm access replaced
source content with the unavailable state, and catalog reads remained available.
API tests additionally assert forbidden writes and malformed/client-owned input.

The first final browser attempt exposed two test-only selector mismatches: the
pagination link's accessible name is `Next products page`, and the kind filter is
reliably addressed as the `Kind` combobox. The test selectors were corrected;
the complete two-test browser run then passed. A required-field assertion was
added to the management browser flow and the complete two-test run passed again.
The runner's Windows server shutdown did not terminate promptly, so after both
test results had completed successfully the three processes it had started for
the API/proxy/web server were stopped by PID. The wrapper exited 0 and reported
`2 passed`; no test timeout or assertion was relaxed. No CI result is claimed for
these uncommitted changes.

## Final integrity audit

| Check                                  | Result and evidence                                                                                                                                                                                                                                                                                                                                 | Remaining risk                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cross-organization product references  | PASS — org predicates scope product/item/flock operations in `apps/api/src/modules/sales-catalog/sales-catalog.service.ts:99-123, 492-500, 547-550`; tenant and foreign-ID cases in `sales-catalog.integration.spec.ts` passed.                                                                                                                     | Requires all future writers to preserve these scoped APIs/constraints.                                         |
| Unauthorized farm/flock eligibility    | PASS — guarded routes require active organization and farm contexts plus catalog/flock permissions in `poultry-sources.controller.ts:34-65`; `verifyFarm`/`flock` scope by farm and organization in `sales-catalog.service.ts:524-550`; integration and STAFF browser tests passed.                                                                 | In-flight authorization follows existing request-time membership/access semantics.                             |
| Inventory-definition/catalog races     | PASS — create and update acquire the planned inventory definition lock before checking category, active state and expected unit (`sales-catalog.service.ts:139-148, 451-468, 492-510`); API tests exercise concurrent unit edit/create and concurrent relink/update.                                                                                | Unmanaged SQL or a writer bypassing M5-LOCK remains outside the shared protocol.                               |
| Unsafe source identity changes         | PASS — product definition freezes after order/source references (`sales-catalog.service.ts:204-229`); source identity is discovered then re-read under product/source/flock locks and lifecycle updates constrain organization/farm/product (`sales-catalog.service.ts:362-428`); database persistence tests and integration identity tests passed. | No reparenting/repair API is provided; corrections require an explicitly designed future operation.            |
| Stale farm-scoped frontend state       | PASS — keyed source/attach components include organization, farm, product and query identity (`apps/web/components/sales-catalog/sources.tsx:114-205`); browser switching both farms and organizations confirmed old source data disappears.                                                                                                        | Browser/Next cache semantics remain those of existing no-store management fetches and scoped server rendering. |
| Unauthorized operational data exposure | PASS — organization DTO selects only the M5-02 product fields (`sales-catalog.service.ts:18-28, 47-63`); farm details are only loaded by the farm-scoped source route (`:32-43, 272-304`); STAFF/unassigned/revoked-farm browser assertions passed.                                                                                                 | New response fields or broader list endpoints need the same explicit projection review.                        |
| Inventory unit / source validation     | PASS — client observed unit is sent by the server action (`apps/web/app/app/sales-products/actions.ts:21`), checked against the locked active PRODUCE definition (`sales-catalog.service.ts:492-510`); wrong/stale units and invalid/inactive sources are covered by the API suite.                                                                 | Existing inventory history has no original-unit snapshot; deployment must follow the write barrier below.      |

Focused tests cover tenant and farm boundaries, invalid/inactive sources,
source identity immutability, unique/required constraints, product lifecycle,
pagination, redaction, unit races, flock closure, duplicate source attachment,
and rejected-operation rollback. No blocking CAT defect remains identified.

The browser runner accepts an optional config argument while preserving its
existing poultry default:

```
cd apps/web
node e2e/run-poultry.mjs playwright.catalog.config.ts
```

Known inherited limits include Windows browser-server shutdown sensitivity and
the existing 10,000 ms database teardown hook limit under heavy parallel load.
No timeout or assertion is relaxed. The initial sandboxed production build also
requires network access for the existing Next.js Google Fonts dependency; the
final build succeeded in this environment.

## Scope and remaining risks

No order endpoint/UI, fulfilment or stock posting, reservation, depletion writer,
population-v2 activation, invoice/payment implementation, dependency upgrade or
unrelated M3/M4 refactor is included. Existing ledger/population calculation and
Prisma migration files remain unchanged. The only M3 behavior addition is the
optional category filter required by the produce picker.

Focused overlap tests cover stale produce units, concurrent product relinking,
flock closure and duplicate attachment. The inherited M5-LOCK suite runs in the
full regression suite and covers first-catalog-link winners and item/history
protections. These tests are not a proof against every PostgreSQL deadlock.
Unmanaged SQL/legacy writers remain unsafe; shared advisory hash collision
serialization and authorization revocation after an in-flight request's checks
remain existing operational boundaries. Future fulfilment/multiple-flock/
command/Order locking and exact retry behavior require their owning tickets'
coverage. Current catalog operations create no physical effects requiring
fulfilment idempotency receipts.

No commit, push, deployment or M5-POP work is part of this implementation task.

## Files changed

- `apps/api/src/app.module.ts`
- `apps/api/src/modules/authorization/permissions.ts`
- `apps/api/src/modules/authorization/role-permissions.ts`
- `apps/api/src/modules/inventory/inventory-items.service.ts`
- `apps/api/src/modules/sales-catalog/poultry-sources.controller.ts`
- `apps/api/src/modules/sales-catalog/sales-catalog.controller.ts`
- `apps/api/src/modules/sales-catalog/sales-catalog.integration.spec.ts`
- `apps/api/src/modules/sales-catalog/sales-catalog.module.ts`
- `apps/api/src/modules/sales-catalog/sales-catalog.service.ts`
- `apps/web/app/app/sales-products/[productId]/edit/page.tsx`
- `apps/web/app/app/sales-products/[productId]/page.tsx`
- `apps/web/app/app/sales-products/actions.ts`
- `apps/web/app/app/sales-products/new/page.tsx`
- `apps/web/app/app/sales-products/page.tsx`
- `apps/web/components/application/shell.tsx`
- `apps/web/components/sales-catalog/editor.tsx`
- `apps/web/components/sales-catalog/forms.tsx`
- `apps/web/components/sales-catalog/sources.tsx`
- `apps/web/e2e/catalog.browser.ts`
- `apps/web/e2e/run-poultry.mjs`
- `apps/web/lib/management/api.ts`
- `apps/web/lib/management/sales-catalog-actions.test.ts`
- `apps/web/lib/management/sales-catalog.tsx`
- `apps/web/playwright.catalog.config.ts`
- `docs/m5-cat-sales-catalog.md`
- `packages/validation/src/index.ts`
- `packages/validation/src/inventory.spec.ts`
