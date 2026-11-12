# M4 poultry workflow

This guide describes the implementation through M4-11. Use the pinned versions
and run commands from the repository root. Read the [M1 workflow](m1-workflow.md)
for identity provisioning and sessions, and the README's [M2](../README.md#m2-customer-and-supplier-master-data)
and [M3](../README.md#m3-inventory-foundation) sections for shared management and
inventory conventions. See the [M4 validation report](audits/m4-12-poultry-validation.md)
for executed evidence and the [M4-11 audit](audits/m4-11-poultry-coverage.md) for the
coverage matrix. This guide does not add product capabilities.

## Ownership and lifecycle

An Organization owns many Farms. Each `Flock` belongs to exactly one organization
and farm, enforced by a composite farm foreign key. A flock represents a placement
batch, with UUID, organization-wide generated `FLK-000001`-style code, name,
optional bird type, placement date, positive integer `startingBirdCount`, optional
expected maturity date/notes, `isActive` and creation/update timestamps. Bird type
is text, not a species enum. Expected maturity cannot precede placement.

`isActive=true` means active; false means closed. Close/reactivate are explicit,
idempotent commands that preserve the definition, starting population and history.
Closed flocks remain readable but cannot receive ordinary mortality/feed postings.
Lifecycle is independent of maturity: a closed flock can have reached its expected
maturity date. Neither dimension is a health assessment.

Birds are not `InventoryItem` records. Their placement and deaths belong to the
poultry domain, not the stock ledger. `InventoryItem` instead defines an
organization-owned reusable supply (such as feed), whose physical stock is
farm-scoped. One feed definition can serve multiple farms with independent stock.
Mortality does not create inventory movements.

Sources: [Prisma models](../apps/api/prisma/schema.prisma), migrations for
[Flock](../apps/api/prisma/migrations/20261101181635_create_flock/migration.sql),
[MortalityEvent](../apps/api/prisma/migrations/20261102052911_create_mortality_event/migration.sql)
and [FeedUsage](../apps/api/prisma/migrations/20261102140231_create_feed_usage/migration.sql).
The migrations enforce positive counts/quantities, ownership, actor membership,
full scoped reversals and immutable poultry histories. There are no independently
persisted live-population, mortality or cumulative-feed counters/snapshots.

## Verified organization, farm and permission context

The API uses `AuthGuard`, `AuthorizationGuard` and `FarmAccessGuard`, in that order.
The token establishes identity; the current organization membership establishes
permissions. Organization/farm route IDs select a scope that must be verified;
payload IDs, roles and permissions are never access grants. Queries, counts,
aggregates and writes retain organization/farm/flock predicates. Composite foreign
keys also prevent an event, feed item or linked movement crossing ownership.

The existing centralized [policy](../apps/api/src/modules/authorization/role-permissions.ts)
currently grants:

| Permission              | OWNER / ADMIN                        | MANAGER                 | STAFF                   |
| ----------------------- | ------------------------------------ | ----------------------- | ----------------------- |
| `flock:read`            | Yes                                  | Yes                     | Yes                     |
| `flock:manage`          | Yes                                  | Yes                     | No                      |
| `flock:mortality-post`  | Yes                                  | Yes                     | Yes                     |
| `flock:feed-usage-post` | Yes                                  | Yes                     | Yes                     |
| Operational farm access | All active farms in the organization | Active assignments only | Active assignments only |

Farm access is separate from action permission. No role in another organization
grants access here. Inactive identities, organizations, memberships, farms or
required assignments cannot establish the operational context. Missing/foreign/
unassigned farm selection is denied; a foreign flock inside an otherwise valid
scope has the same safe not-found behavior as a nonexistent flock. Authentication
failures remain 401 and authorization failures 403.

The web reuses `ApplicationShell`, `applicationHref` and verified application
context. `flock:read` controls navigation/access; `flock:manage` controls definition
and lifecycle controls. Operational forms require their respective posting
permissions. STAFF has read-only **definition** access but may post events.
Feed selection also needs `inventory:read`. Server actions recheck context and
permissions; hidden organization/farm fields are selectors only. Backend guards
remain authoritative. Farm switching reloads scoped flock/history/stock data.

## Mortality ledger and population

`MortalityEvent` stores organization, farm, flock, actor, positive integer
`deathCount`, occurrence/creation timestamps and optional cause, note/reference.
The actor is taken from verified context and must belong to the organization.
Posting through [MortalityService](../apps/api/src/modules/poultry/mortality.service.ts)
locks the scoped flock and checks the current effective mortality before inserting.
The same advisory/row lock protects starting-population edits and mortality
reversals. Concurrent posts or an edit racing a post cannot consume population
independently.

```text
effectiveMortality = SUM(original deathCount) - SUM(full reversal deathCount)
liveBirdCount = startingBirdCount - effectiveMortality
```

A post exceeding remaining population fails with `FLOCK_OVER_MORTALITY` and
creates no event. The exact remaining population may be posted, producing zero
live birds. Starting population is a definition baseline, not a live counter;
permitted edits cannot reduce it below effective mortality. Partial date edits
are merged with the latest persisted counterpart and validated together. These
edits do not rewrite posted history.

Database triggers forbid UPDATE/DELETE/TRUNCATE of mortality history. The internal
`MortalityService.reverse` appends one full positive-count event referencing the
original through `reversesEventId`; the aggregate subtracts it. Duplicate, partial,
cross-scope and reversal-of-reversal corrections are rejected. A replacement is a
new ordinary event. The reversal helper exists for internal/test composition;
there is no public reversal route or UI. It can compensate history for a closed
flock when the farm remains accessible.

## Feed usage and M3 inventory

`FeedUsage` records the scoped flock, organization-owned feed item, actor,
positive `Decimal(18,3)` consumption quantity, occurrence/creation timestamps,
optional note/reference and a unique `inventoryMovementId`. Posting requires an
active flock and active same-organization item in category `FEED`.

[FeedUsageService](../apps/api/src/modules/poultry/feed-usage.service.ts) calls M3's
`InventoryStockService.postMovementInTransaction` inside the **same** transaction:

```text
FeedUsage quantity = +q
linked InventoryMovement quantity = -q, reason = ISSUE
farm stock = SUM(signed inventory movement quantities for organization/farm/item)
```

The linkage requires the same organization, farm, item, actor, occurrence time
and matching quantity/reason. M3's stock-position advisory lock serializes
concurrent consumption. A negative resulting stock fails with
`INSUFFICIENT_INVENTORY_STOCK`; failure of either insert rolls back both. The
frontend submits one feed request, never a second inventory movement and never
maintains a separate stock balance.

The internal `FeedUsageService.reverse` appends a full positive-quantity reversal
referencing `reversesUsageId` and creates a positive `ADJUSTMENT` of that quantity
in one transaction. It restores farm stock while preserving the original usage
and ISSUE. Only one full reversal of an original is allowed. A replacement is
another ordinary usage. Compensation may reference an inactive flock/item, with
verified farm access. No public reversal endpoint/control exists. Feed history
and its linked movement are protected against mutation; no cleanup should disable
these protections or delete committed poultry history.

## Derived indicators and dates

[FlockMetricsService](../apps/api/src/modules/poultry/flock-metrics.service.ts)
reads a consistent snapshot and reuses the existing
[M4-05 calculation](../apps/api/src/modules/poultry/flock-metrics.ts) and scoped
[ledger aggregates](../apps/api/src/modules/poultry/poultry-history.ts).

| Indicator             | Authoritative definition                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cumulativeMortality` | Effective mortality, including full reversals                                                                          |
| `liveBirdCount`       | Starting population minus effective mortality                                                                          |
| `mortalityPercentage` | `effectiveMortality * 100 / startingBirdCount`, decimal percentage points rounded half-up to six decimal places        |
| `ageDays`             | Completed UTC calendar days between placement and as-of date                                                           |
| `ageWeeks`            | `floor(ageDays / 7)`, completed weeks                                                                                  |
| `daysToMaturity`      | `max(0, expectedMaturityDate - asOfDate)` in UTC calendar days; null when no expected date exists                      |
| `cumulativeFeedUsage` | Original quantities minus full reversal quantities, grouped by inventory item and its unit; decimal strings in the API |

Placement day has age zero. The API requires a valid `YYYY-MM-DD`
`ageAndMaturityAsOfDate` on list/detail reads; dates before a returned flock's
placement fail with `FLOCK_INVALID_AS_OF_DATE`. The web boundary helper
`flockMetricsDate()` resolves today's **UTC** date. Components display API metrics
rather than calculating domain values. Occurrence timestamps accept ISO 8601
offsets; the posting UI converts its explicitly labelled local date/time to ISO.

The as-of date controls **only age and maturity**. It is not a historical cutoff
for mortality/feed/population: all current posted ledger entries contribute,
including entries with later occurrence timestamps. No historical stock snapshot
is implied. Feed totals do not combine unrelated items/units into a grand total;
a fully reversed item can remain as a zero-quantity aggregate row.

| API maturity state             | UI label                  | Boundary                                |
| ------------------------------ | ------------------------- | --------------------------------------- |
| `BEFORE_EXPECTED_MATURITY`     | Not yet mature            | Expected date strictly after as-of date |
| `AT_OR_PAST_EXPECTED_MATURITY` | Expected maturity reached | Expected date on or before as-of date   |
| `NO_EXPECTED_MATURITY_DATE`    | No expected maturity date | Expected date is null                   |

These describe the **expected date, not confirmed biological maturity**. The
countdown explains proximity; no separate approaching-maturity threshold is
invented. Active/closed status is displayed separately. Mortality percentage does
not label a flock healthy/unhealthy. There are no forecasts, health scores or FCR.

## Public poultry API

All routes below are under
`/api/organizations/:organizationId/farms/:farmId/flocks`, require bearer
authentication and verified organization/farm access, and use shared
[Zod input contracts](../packages/validation/src/index.ts) and
[response types](../packages/types/src/flock.ts).

| Method | Suffix                 | Permission              | Behavior                                           |
| ------ | ---------------------- | ----------------------- | -------------------------------------------------- |
| GET    | `/`                    | `flock:read`            | Paginated flocks with metrics; required as-of date |
| POST   | `/`                    | `flock:manage`          | Create active flock; definition response           |
| GET    | `/:flockId`            | `flock:read`            | Definition plus metrics; required as-of date       |
| PATCH  | `/:flockId`            | `flock:manage`          | Update permitted definition fields                 |
| POST   | `/:flockId/close`      | `flock:manage`          | Close without deleting history                     |
| POST   | `/:flockId/reactivate` | `flock:manage`          | Reactivate                                         |
| GET    | `/:flockId/mortality`  | `flock:read`            | Paginated history, including reversals             |
| POST   | `/:flockId/mortality`  | `flock:mortality-post`  | Append an ordinary mortality event                 |
| GET    | `/:flockId/feed-usage` | `flock:read`            | Paginated history, including reversals             |
| POST   | `/:flockId/feed-usage` | `flock:feed-usage-post` | Append usage and atomically ISSUE stock            |

There are no poultry DELETE routes, event PATCH routes, separate public metrics
routes or reversal routes. Close/reactivate take an empty object. Creates accept
only `name`, `birdType`, `placementDate`, `startingBirdCount`,
`expectedMaturityDate`, `notes`. Updates accept a nonempty subset of those fields;
nullable optional fields can be cleared. Ownership, code, actor, lifecycle,
timestamps, linked movement IDs and metrics are never ordinary body inputs.

Mortality accepts `deathCount`, `occurredAt`, optional `cause`, `note`, `reference`.
Feed accepts `inventoryItemId`, positive `quantity` with at most three decimal
places (a decimal string preserves full precision), `occurredAt`, optional
`note`, `reference`. Unknown body fields fail validation. Death counts/starting
population are integers from 1 to 2,147,483,647; consumption is at most
999,999,999,999,999.999. Safe validation/business error envelopes follow the README.

List queries support case-insensitive code/name/bird-type `search`, exact
`birdType`, `isActive=true|false`, `maturityState`, required as-of date and
`page`/`pageSize`. All filters apply server-side **before** counts and pagination,
with code/id ascending order. Lifecycle and maturity filters are independent.

Histories support `page`/`pageSize`, ordered occurrence time, creation time and ID
descending. Defaults are page 1, size 20; maximum size 100 and page 1,000,000.
Counts and rows share scoped snapshots. Resources return `{ data }`; collections
return `{ data, meta: { page, pageSize, totalItems, totalPages } }`. Event DTOs expose
actor IDs, occurrence time, metadata and reversal links; actor display names are
not supplied by these contracts. Original and reversal records remain visible.

## Web workflow

Use Poultry / Flocks in the existing authenticated shell. Routes are
`/app/flocks`, `/app/flocks/new`, `/app/flocks/:flockId` and
`/app/flocks/:flockId/edit`, with the verified organization/farm selection carried
by `applicationHref`. Detail displays definition, lifecycle, all available
indicators, mortality/feed forms and separately paginated histories.

1. Sign in with a provisioned user and select an accessible farm.
2. With `flock:manage`, create a placement and edit allowed details. Closing hides
   ordinary posting forms; reactivate to resume. History remains available.
3. With the posting permissions, enter positive deaths or feed consumption and
   occurrence time/metadata. Forms warn that posted history is immutable.
4. Feed choices show names, units and API-derived farm availability for active
   FEED items; out-of-stock options are disabled. Historical identity retains
   inactive items when available; unresolved identity displays `Feed item <id>`.
5. Successful actions revalidate `/app` layout data, refreshing metrics, relevant
   history and stock. Posting inputs clear only after confirmed success; errors
   retain input and pending submission is disabled. This reduces duplicate clicks
   but is not a persisted idempotency-key guarantee.
6. Switch farms through the shell; old flock/history data must not appear in the
   new scope. Changed/revoked context is rechecked on requests and mutations.

Forms stack on narrow screens; long tables scroll within their containers and
status text is accessible without depending on color. Existing browser tests
exercise mobile widths of 375px and desktop widths of 1440px. No manual visual
inspection is implied by automated overflow assertions.

## Local setup and repeatable verification

Install with `pnpm install --frozen-lockfile`, configure `.env` from
`.env.example` and start local PostgreSQL/Redis with `docker compose up -d`.
Keep the root README's pinned versions and independent JWT secrets. For a new,
developer-owned local database only:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
pnpm --filter @ancastle/api db:seed
```

The seed creates/updates the development organization and MAIN farm, not a login.
Use the M1 first-owner recipe, then protected Users administration. No flock/feed
test data or default password is installed. Do not run seed or database resets
against shared/production data. No new migration is needed for this guide.

For automated milestone validation, use the established
[`temporaryDatabase()`](../apps/api/src/test/temporary-database.ts) helper rather
than changing the configured database. It creates its own random
`poultry_test_<uuid>` database, replays every committed migration in order and
drops only that owned database in `finally`. The local connection needs CREATEDB
and permission to dispose its database. Do not disable ledger triggers or delete
committed history to clean fixtures. Redis/browser sessions use test prefixes.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

Run `pnpm test` with a disposable database URL, as shown in the validation report;
M1-M3 tests otherwise use the configured database for isolated fixtures. The focused
poultry command and disposable wrapper are also reproduced there. Build first:
the browser runners import the compiled helper and start production API/web servers.
Install Chromium if absent with `pnpm --filter @ancastle/web exec playwright install chromium`.
Keep ports 3310, 4310 and 4311 free; PostgreSQL and Redis must be reachable.

```bash
pnpm --filter @ancastle/web exec node e2e/run-poultry.mjs
git diff --check
```

The existing poultry runner executes M4-09/M4-10 browser scenarios against its
owned disposable database. The report also shows how to run the existing M4-08
management browser scenario using the same helper and existing Playwright CLI.
Run browser invocations sequentially because they own the same fixed ports.
They use real APIs through the existing test proxy; traces, screenshots and videos
are disabled. No new test framework, runner or product behavior is required.
