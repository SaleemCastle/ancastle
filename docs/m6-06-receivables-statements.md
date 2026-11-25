# M6-06 Receivables and Customer Statements

## Scope and approved policies

M6-06 adds read-only, organization-scoped receivables and historical customer statements over the M6-04 invoice ledger and M6-05 allocation ledger. Invoices, payment allocations, allocation reversals, and payment lifecycle events remain immutable. Credit notes, customer balance counters, exports, refunds, and credit application are out of scope.

- Business timezone is `America/Jamaica`.
- CASH invoices are due on the Jamaica calendar issue date.
- CREDIT invoices are due on the Jamaica issue date plus the snapshotted number of calendar days. Weekends and public holidays count.
- Existing invoice `dueAt` values are preserved. The Jamaica rule applies to invoices issued after deployment; no historical due-date update runs.
- Aging uses the stored invoice due date and the requested Jamaica as-of calendar date. A due date equal to the as-of date is CURRENT; overdue begins the next calendar day.
- Aging buckets are CURRENT, 1_TO_30, 31_TO_60, 61_TO_90, and OVER_90 (91+).
- Pending and reversed payments are excluded from unapplied cash. Verified, non-reversed unallocated amounts are reported separately and never reduce receivables automatically.
- Statement date ranges are inclusive Jamaica calendar dates. Statement rows use transaction timestamps converted from stored UTC timestamp values to `America/Jamaica` business dates.

## Financial formulas and exact money

For an issued invoice at the current ledger snapshot:

```text
active allocation = allocation amount with no allocation reversal
invoice outstanding = invoice gross amount - sum(active allocations)
customer outstanding = sum(invoice outstanding for the customer)
```

An outstanding amount equal to gross is UNPAID, between zero and gross is PARTIALLY_PAID, and zero is PAID. An invoice is overdue only when outstanding is positive and its due date is before the requested as-of date. Paid invoices contribute zero to each aging total.

Customer unapplied cash is:

```text
sum(verified, non-reversed payment amount - net allocations as of the read cutoff)
```

It is a separate informational amount, not a negative receivable.

Statement rows are signed ledger events: invoice issuance is a debit, payment allocation is a credit, and allocation reversal is a debit. Opening balance is the sum of events before `from`; closing balance is the sum through inclusive `to`, both limited to events effective no later than `asOfAt`.

Amounts are read from PostgreSQL `NUMERIC`/`DECIMAL` as decimal text and converted to `bigint` cents for application arithmetic. No money value passes through JavaScript `Number`. A single financial record supports the existing `DECIMAL(34,2)` capacity; customer aggregates use PostgreSQL arbitrary precision and `bigint`, and their response string can exceed 32 integer digits.

## Historical cutoff semantics

The statement query uses one PostgreSQL `RepeatableRead` transaction for customer identity, ledger totals, page rows, and unapplied cash.

- If `asOf` is omitted, `asOfAt` is the final millisecond of the requested `to` date in Jamaica.
- If `asOf` is supplied, the earlier of that instant and the end of `to` is used. A cutoff cannot include activity after the requested period.
- Each invoice, allocation, and allocation reversal retains its own transaction timestamp (`issuedAt`, `createdAt`, and reversal `createdAt`). Its display/filter business date is that instant converted from stored UTC to `America/Jamaica`.
- Opening balance includes events whose Jamaica business date is before `from` and whose transaction timestamp is at or before `asOfAt`.
- Period rows include events with a Jamaica business date from `from` through `to`, inclusive, and a transaction timestamp at or before `asOfAt`.
- Events created after `asOfAt` do not change the historical statement, even if their effective business date would otherwise fall within the requested range.
- Rows sort by business date, transaction timestamp, event class (invoice, allocation, reversal), then stable event UUID. Pagination does not change opening or closing balances.
- Historical unapplied cash is reconstructed from payment verification, reversal, allocation, and allocation-reversal events at the same cutoff. Pending or reversed payments are unavailable at that historical cutoff.

Current receivable totals use the currently active allocation history. The `asOfDate` query parameter on receivables controls aging; it does not rewind current allocation history. Historical financial balances are provided by the statement endpoint with its `asOf` timestamp.

## API contracts

All routes require authenticated active organization membership and return the established `{ data }` or `{ data, meta }` envelope. Money values are JMD decimal strings. Lists use page/pageSize pagination (maximum page size 100).

| Route                                                                  | Permission        | Query inputs                                                                     |
| ---------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `GET /organizations/:organizationId/receivables/invoices`              | `receivable:read` | `page`, `pageSize`, `customerId`, `status`, `overdue`, `agingBucket`, `asOfDate` |
| `GET /organizations/:organizationId/receivables/customers`             | `receivable:read` | `page`, `pageSize`, `search`, `asOfDate`                                         |
| `GET /organizations/:organizationId/receivables/customers/:customerId` | `receivable:read` | `asOfDate`                                                                       |
| `GET /organizations/:organizationId/customers/:customerId/statements`  | `statement:read`  | required `from`, `to`; optional offset-aware `asOf`; `page`, `pageSize`          |

Invoice receivable rows include gross, active allocated, outstanding, payment state, overdue state, days overdue, and bucket. Customer summaries include invoice counts, overdue count, total outstanding, separate unapplied cash, and aging totals. Statement responses include organization/customer identifiers, inclusive dates, explicit `asOfAt`, opening and closing balances, unapplied cash, ordered entries, and pagination metadata. Payment method, evidence, recorder, and payment IDs are not exposed by receivable or statement responses.

Only JSON is implemented. CSV/PDF export is not included.

## Authorization matrix

`invoice:read` and `payment:read` do not imply either new permission. This release restricts receivables and statements to OWNER, ADMIN, and MANAGER; STAFF receives neither permission. Payment detail remains governed by the existing `payment:read` policy.

| Organization role | `receivable:read` | `statement:read` |
| ----------------- | ----------------: | ---------------: |
| OWNER             |               Yes |              Yes |
| ADMIN             |               Yes |              Yes |
| MANAGER           |               Yes |              Yes |
| STAFF             |                No |               No |

The guard derives organization context from the verified active membership. Service reads re-check active membership, organization, user, role, and permission. Queries constrain both organization and customer where applicable; a customer ID from another organization returns not found.

## Persistence and indexes

No balance or statement snapshot table is introduced. A migration adds query indexes to invoices by organization/due date, organization/customer/due date, and payment allocations by organization/customer/transaction date. Existing allocation/reversal and payment lifecycle events remain the source of truth. The migration performs no data rewrite and does not update invoice due dates.

## Testing evidence

Database-backed tests use a disposable PostgreSQL database. Coverage includes unpaid/partial/paid states; active allocation reversals; pending and unapplied payments; every aging boundary; statement opening/closing and inclusive Jamaica date boundaries; transaction-time cutoffs; stable ordering; large single amounts and customer aggregate overflow; concurrent statement reads during payment allocation; tenant/customer isolation; inactive membership; and STAFF permission denial. Shared Zod tests cover query bounds, date range order, offset-aware cutoff, response envelopes, and decimal-string precision. Due-date tests cover CASH/CREDIT rules and UTC instants on either side of Jamaica midnight.

## Known limitations

- Credit notes are explicitly excluded; balances are invoice gross less payment allocations only.
- Current receivable `asOfDate` affects aging, not historical allocation reconstruction. Use statements for historical balances.
- Statement pagination returns a page of rows while opening/closing balances cover the full cutoff/range.
- No export format, customer-facing portal, automatic allocation, refunds, or credit application is provided.
- Query performance depends on organization/customer volume and the new indexes; production workload plans should be reviewed before large-scale reporting.
- Production invoice issuance and sales depletion remain controlled by their existing default-off configuration and are not enabled here.
