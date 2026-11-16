# M5-07 customer order and purchase history

## Endpoint

`GET /api/organizations/:organizationId/customers/:customerId/orders`

Requires the existing `order:read` permission in an active membership for the
route organization. Authorization does not use a request body or a role from
another organization. The service first verifies that the selected M2 customer
belongs to that organization; a missing or foreign customer returns the same
safe `CUSTOMER_NOT_FOUND` response.

Query parameters are strict and use the shared sales and pagination contracts:

| Parameter  | Meaning                                                    | Bounds                              |
| ---------- | ---------------------------------------------------------- | ----------------------------------- |
| `page`     | One-based result page                                      | 1–1,000,000; defaults to 1          |
| `pageSize` | Maximum results on one page                                | 1–100; defaults to 20               |
| `state`    | `DRAFT`, `CONFIRMED` or `CANCELLED`                        | Optional                            |
| `progress` | `UNFULFILLED`, `PARTIALLY_FULFILLED` or `FULFILLED`        | Optional; derived before pagination |
| `search`   | Search order code or immutable customer code/name snapshot | Up to 120 characters                |

The `customerId` is fixed by the route and is rejected if supplied as a query
parameter. Results are ordered by `createdAt DESC, id DESC`. The response follows
the collection convention `{ "data": [...], "meta": {...} }`. Each entry uses
the existing commercial `Order` shape and adds `confirmedAt`, taken from the
immutable CONFIRMED order event (null for a draft). It includes order/customer
identity snapshots, state, creation/confirmation timestamps, CASH/CREDIT terms,
ordered lines, actual net fulfilled quantities, remaining/cancelled quantities,
unit prices and line/order amounts. No fulfilment/source event objects are
nested in this endpoint.

## Ordered and purchased quantities

`orderedQuantity` is the confirmed commercial commitment. `fulfilledQuantity` is
the persisted net physical quantity: committed original fulfilment lines minus
their valid reversal lines. It is never inferred from confirmation or order
state. Draft orders report zero fulfilled quantity. A confirmed order with no
posting is not counted as a purchase. Partial postings contribute only their
posted quantity; full postings contribute the complete quantity. A full posting
reversal subtracts that posting, and cancelled orders retain all un-reversed
historical fulfilment. Cancellation closes the remaining quantity but does not
change the purchased quantity. Valid persistence constraints and projection
checks prevent negative or over-ordered net quantities.

The service uses one PostgreSQL Repeatable Read transaction for customer
ownership, page/count, order/line snapshots, grouped net allocation totals and
confirmation timestamps. A bounded page selects at most 100 orders and each
order's at most 100 lines. It does not load nested fulfilment allocations:
PostgreSQL groups the selected orders' immutable ledger lines by order line and
computes original-minus-reversal totals in one query. Confirmation time is a
second bounded query returning at most one first confirmation per page order.
Progress filtering uses the established sales query that calculates progress
before applying page limits. For customer history, the progress CTE first scopes
orders by organization, customer, state, and search; it then aggregates lines
only for that scoped set. There are no per-order queries and no stored purchase
balance or redundant total.

## Query plan audit

An isolated disposable PostgreSQL database was seeded with 20,000 orders and
20,000 lines across 10 customers (5,000 confirmed; 1,000 confirmed for the
target customer). `ANALYZE` was run before `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)`. The original progress page and count aggregated all 20,000 tenant lines
and took 883 ms and 1,131 ms respectively. Scoping the CTE reduced them to 277
ms and 244 ms. The ordinary page was 2.4 ms. The plan used the existing
`orders_organizationId_customerId_idx` and
`order_lines_organizationId_orderId_lineNumber_key`; no index was added. Timings
are a single local run and not a production load guarantee.

## Visibility and financial boundaries

`order:read` grants whole-order commercial history, including STAFF, as approved
by the M5-01 ADR addendum. The endpoint intentionally returns no operational
farm, flock, inventory item, movement, depletion, allocation, fulfilment, or
idempotency identifiers. It has no source selector or source-dependent filter.
Farm operational history remains available only through the separately
authorized farm fulfilment endpoints.

Order line prices, amounts, customer and product names/codes, and terms come from
persisted order snapshots, not the current catalog or mutable M2 customer row.
CREDIT term days remain commercial intent; CASH does not mean paid. This response
does not create or infer paid amounts, outstanding balances, receivables, invoice
or payment status, credit utilization, or calendar due dates. Invoicing,
payments and customer financial ledgers remain deferred to M6.

## Verification

The focused PostgreSQL integration cases cover drafts, confirmed-unfulfilled,
partial and full quantities, reversal netting, cancelled history, multi-order
pagination and filters, immutable product snapshots, cross-organization customer
isolation, STAFF whole-order progress with farm-source redaction, and the absence
of invoice/payment assumptions. The shared Zod contract tests reject loose
customer filters, invalid page bounds, operational fields and financial fields.

## Verification results

Executed on `m5-07/customer-purchase-history` against a disposable PostgreSQL
database migrated from the committed chain. The sequential workspace regression
used a local one-off harness to create and remove that database; it did not reset
or migrate the configured development database.

| Check                                                                                                                            | Result                                                                           | Exit |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| `pnpm --filter @ancastle/api test -- --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts`                     | 51 PostgreSQL tests passed; 52.99s Vitest                                        | 0    |
| `pnpm test --concurrency=1 -- --maxWorkers=2` with `TURBO_FORCE=true` and `DATABASE_URL` set to the disposable migrated database | API 518/43 files, validation 180/8, web 116/13; 814 passed total, 4m01s uncached | 0    |
| `pnpm format:check`                                                                                                              | All matched files passed                                                         | 0    |
| `pnpm lint`                                                                                                                      | 2 workspace lint tasks passed; API reported 0 warnings/errors                    | 0    |
| `pnpm typecheck`                                                                                                                 | All 4 workspace tasks passed                                                     | 0    |
| `pnpm build`                                                                                                                     | All 4 workspace tasks passed                                                     | 0    |
| `git diff --check`                                                                                                               | Passed                                                                           | 0    |

Vitest passed with the existing timeout settings; none were increased. No Prisma
schema or migration changes were needed. Sales depletion activation remains
disabled; this task adds read-only history behavior only.
