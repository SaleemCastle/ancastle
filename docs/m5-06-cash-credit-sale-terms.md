# M5-06 Cash and Credit Sale Terms

## Commercial terms policy

An order carries commercial intent only:

- `CASH` has `creditTermDays: null`. It means payment is intended at sale or
  handover; it does not mean that payment was received.
- `CREDIT` has a positive integer `creditTermDays` in the PostgreSQL `Int32`
  range. These days record the agreed credit period; they are not an invoice due
  date.
- Orders use JMD only. Unit prices are decimal strings validated to the
  existing `Decimal(19,4)` precision, without binary floating-point arithmetic.

The strict shared `commercialTermsSchema` is the reusable boundary for the
future order API. It rejects a missing or nonpositive credit period, credit
fields on CASH terms, a supplied `dueDate`, payment claims such as `paid`, and
unknown fields. The JMD currency schema rejects other currency codes. Existing
shared order contracts validate date strings where operational timestamps are
used; commercial terms contain no calendar date to parse or compare.

## Due-date boundary

The M5-01 ADR says CREDIT records agreed positive integer credit-term days,
while the due-date clock, invoice due dates and enforceable payment rules belong
to M6. The live M5-06 Trello card's approved ADR addendum repeats that rule.
Accordingly M5-06 does not accept, persist, calculate, or compare a calendar
credit due date. A request containing `dueDate` is rejected. There are no
commercial due-date date-boundary cases in M5; M6 must define its calendar and
timezone rules when it introduces invoice issuance.

## Lifecycle

| Order state     | Terms behavior                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft creation  | Store the selected sale type and its matching nullable/positive credit term.                                                                         |
| Draft amendment | Terms may change as a unit (`CASH` with null days or `CREDIT` with positive days); record the accepted before/after change in the order audit event. |
| Confirmation    | Freeze sale type, credit days, JMD currency and other commercial snapshots. Confirmation is not a payment, reservation, invoice, or due-date event.  |
| Cancellation    | Cancellation does not imply payment or alter the frozen terms. A cancelled order cannot be reopened or have terms amended.                           |

The M5-03 database check constraint enforces the CASH/CREDIT field pairing and
JMD currency. Its order snapshot trigger freezes the confirmed commercial
fields. The M5-03 composite customer foreign key prevents an order from
referencing a customer in another organization. M5-04 must repeat ownership
checks in the authorized service using trusted organization context; database
integrity does not replace request authorization.

## Persistence compatibility

M5-03 already persists `Order.saleType`, nullable `Order.creditTermDays`, and
`Order.currency` (default JMD), with the required check constraint and
confirmation immutability. The schema does not store an invoice due date,
payment state, receivable, or customer balance. M5-06 therefore requires no
schema change or migration and introduces no duplicate commercial state.

## M5-04 integration requirements

- Reuse `CommercialTerms`, `commercialTermsSchema`, `createOrderSchema`, and
  `amendOrderSchema`; do not re-declare CASH/CREDIT rules in API or web code.
- Resolve the customer by both its ID and the authenticated organization ID.
- On draft creation/amendment, validate merged terms as a discriminated pair;
  clients cannot submit organization identity, lifecycle state, version, totals,
  payment fields or due dates as authority.
- Persist terms and append the corresponding audit event in the same
  transaction. Confirmation must acquire the established order lock, recheck
  the draft/version and atomically freeze the commercial snapshot.
- Do not add a payment state or mark CASH as paid. Do not calculate an invoice
  due date; M6 owns that rule.

## Deferred to M6

Invoice creation and due dates, payment collection/allocation, cash evidence,
credit-limit enforcement, receivables, customer balances/statements, refunds,
payment gateways and financial ledgers are outside M5-06. M5-04 may only record
commercial intent and expose the frozen terms.

## Verification scope

The existing M5-02 shared validation tests cover valid CASH and CREDIT terms,
missing/nonpositive/noninteger credit days, contradictory CASH credit fields,
extra due-date/payment fields, JMD-only enforcement, exact price precision and
date-free term semantics. M5-03 PostgreSQL tests cover tenant-scoped customer
references, persisted JMD/credit constraints, absence of a due-date column, and
confirmed snapshot immutability. M5-06 adds a focused lifecycle assertion that
draft credit days may be amended but cannot change after confirmation or
cancellation. No order API, order UI, invoice, payment or sales posting is
implemented by this policy-readiness task.
