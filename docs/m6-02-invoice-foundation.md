# M6 invoice foundation and issuance

## Architecture decision

Invoice issuance is a separate, explicitly authorized command. M5 posts the order, fulfilment, operational ledgers, order version, and fulfilment command receipt in one PostgreSQL transaction; it does not call the invoice service. Issuance discovers only a committed `POSTING` fulfilment, then takes the order row lock and persists the invoice, its source allocations, event, idempotency receipt, and sequence change in its own transaction. An invoice failure leaves the physical fulfilment committed and retryable.

The existing M5 lock sequence remains authoritative for M5: organization, fulfilment command advisory lock, order, definitions, flocks, then stock. M6 obtains an organization-scoped invoice-command advisory lock before locking the order. M5 never waits on the M6 advisory lock, so invoice failure or tax activation cannot block physical posting. Invoiced reversal is denied in the application and by a database trigger until credit notes exist.

## Source and amount rules

Each invoice represents one posted fulfilment; therefore partial fulfilments create independent invoices, while later fulfilments for the same order remain invoiceable. A unique `(organizationId, fulfilmentId)` and unique fulfilled-line allocation enforce non-duplication. Invoice line quantity comes from `FulfilmentLine`; description, unit price, and commercial terms come from immutable M5 order snapshots. PostgreSQL Decimal values and Prisma Decimal arithmetic are used throughout. Line values are rounded half-up to JMD cents; invoice gross is the sum of rounded line amounts.

## Numbering and retry

An organization sequence row is upserted and incremented inside the invoice transaction. Unique organization/invoice-number storage is a final guard. Rolled-back transactions do not consume sequence numbers; gaplessness is not guaranteed. The idempotency receipt is unique by organization and key and carries a request hash, fulfilment source, actor membership, and resulting invoice. Same key and same command returns the original invoice. Key reuse with another actor, source, or hash conflicts.

## Tax activation

No tax is calculated in this release. `M6_INVOICE_ISSUANCE_ENABLED` defaults to false. A second readiness flag is not sufficient: runtime also requires a validated, explicit approved-policy state, reference, and version. Missing, unresolved, malformed, or incomplete configuration fails before any invoice/sequence write. `APPROVED_POLICY_NOT_CALCULATED` is only a workflow state and does not claim legal compliance. Production issuance remains off until accounting/legal approval confirms the applicable treatment and statutory invoice requirements.

## Permissions and API

**APPROVED visibility policy:** STAFF with explicit `invoice:read` may read invoices across all farms in their active organization; farm assignment is not required. Organization isolation and active membership remain mandatory. `invoice:read` does not permit issuance or modification. OWNER/ADMIN have organization-wide access under their existing permissions. No FINANCE role exists in the current membership-role enum; future FINANCE access needs an explicit permission mapping. The API exposes organization-scoped invoice list/detail and issue-for-fulfilment only; clients cannot submit organization/customer/price/quantity or arbitrary invoice lines. Tenant IDs come from verified organization context and all queries constrain organization ownership.

No separate FINANCE membership role is part of M6. Existing OWNER, ADMIN, MANAGER, and STAFF roles retain explicit permission mappings; STAFF invoice reads remain organization-wide as approved.

## Lifecycle and exclusions

The initial lifecycle records only immutable `ISSUED` invoices and append-only `ISSUED` events. Corrections require a future credit-note workflow. Invoiced source fulfilment reversals are blocked. Payments, payment verification, allocations, receivables settlement, statements, tax computation, provider integration, revenue recognition, and customer account balance fields are excluded. Production sales depletion and invoice issuance gates remain disabled by default.

## Acceptance evidence

M6-01 architecture rationale is recorded in `m6-01-financial-architecture.md`. M6-02 shared invoice types and Zod validation are added. M6-03 contains tenant-scoped persistence, numbering, source allocation, immutable-history, reconciliation, and reversal constraints. M6-04 contains the independently invoked issuance service and read/issue endpoints. The follow-on integrity migration adds serialized rejection of invoicing reversed fulfilments, a mandatory unique issuance event, and source customer/currency checks. Runtime database concurrency and migration deployment require disposable PostgreSQL integration verification before production activation.

The amount-capacity migration widens M6 `lineAmount` and `grossAmount` to `DECIMAL(34,2)`, which covers M5's exact maximum line and 100-line gross while retaining two-decimal JMD rounding. M5 quantity and unit-price limits are unchanged.
