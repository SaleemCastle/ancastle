# M6-01 Financial Architecture (reconciled)

## Status and approved constraints

M6 financial records are tenant scoped to an organization. Physical fulfilment is the M5 operational ledger and remains independent of financial issuance. The approved direction is explicit, separately authorized invoice issuance against successfully committed `POSTING` fulfilments. No order-only invoices, automatic invoice work in the M5 transaction, payments, or production activation are included here.

## Existing integration

M5 records `Order`, immutable `OrderLine` commercial snapshots, `Fulfilment`, `FulfilmentLine`, and a committed `FulfilmentCommand` in its existing PostgreSQL transaction. M5 serializes order mutations by locking the organization and order before source/stock locks; invoice issuance takes the same order row lock after obtaining its own organization-scoped idempotency advisory lock. Fulfilment posting does not import or call the invoice module. A posting succeeds or fails solely on M5 operational rules.

## Proposed invoice model

An invoice is issued for one committed fulfilment. Its lines reference the source fulfilment lines and order lines, preserving product description, quantity, unit, unit-price snapshot, and rounded line amount. An organization-scoped `InvoiceSequence` allocates invoice numbers transactionally. A unique organization/fulfilment constraint and unique source-line allocation prevent duplication. Invoices, lines, allocation links, and lifecycle events are immutable. Tax status is explicit; the application stores the approved policy reference and version and performs no tax calculation.

## Reversal and recovery

An uninvoiced fulfilment may use existing M5 reversal behavior. Once any source fulfilment is invoiced, the application and database reject reversal until a compensating credit-note workflow is available. Failed invoice attempts roll back invoice, sequence, allocations, command receipt, and events together; the committed fulfilment remains valid and can be retried.

## Authorization and activation

**APPROVED:** STAFF with explicit `invoice:read` permission may view invoices across all farms in their active organization; a farm assignment is not required. Organization isolation and active membership are mandatory. `invoice:read` does not imply issue or modification authority. OWNER/ADMIN have organization-wide access under their existing permissions. The current membership-role model has no FINANCE role; any later FINANCE role must receive explicit mappings rather than inheriting access implicitly. `invoice:read` remains separate from order/fulfilment read. Organization context comes from verified membership, never request-body identifiers. Issuance requires both default-off `M6_INVOICE_ISSUANCE_ENABLED` and `M6_INVOICE_TAX_POLICY_READY`, plus bounded policy reference and version. Those fields are metadata and do not calculate or establish legal compliance. Production activation remains prohibited until tax/accounting approval is confirmed.

## Scope map

- M6-01: this architecture decision and its approved independent transaction boundary.
- M6-02: shared invoice types and Zod request/response validation are included; no arbitrary/manual issuance endpoint is added.
- M6-03: invoice persistence, indexes, tenant foreign keys, sequence, allocations, immutable-history and reversal guards are present in this foundation branch.
- M6-04: separately authorized fulfilment-backed issue operation, read/list endpoint, idempotency, numbering, and audit event are present. Full payment/credit note/customer-ledger features remain out of scope.

## Open accounting decisions

Accounting/legal owners must approve applicable tax treatment, registrations, exemption evidence, statutory invoice fields, and document retention. No Jamaican rate, exemption or status is assumed. They must also confirm whether cash orders are due on issue and validate invoice prefix/number presentation before production.

## Monetary capacity decision (resolved)

M5 permits line quantity through `999999999999999.999` and unit price through `999999999999999.9999` (database constraints in the M5 sales migration). Their maximum product rounds to `999999999999999998900000000000.00` (30 integer digits). Across the maximum 100 lines, gross is `99999999999999999890000000000000.00` (32 integer digits). M6 uses `DECIMAL(34,2)` for line amounts and invoice gross, preserving JMD cents and the M5 half-up line rounding while covering both maxima. M5 quantity and unit-price bounds are unchanged. A separate FINANCE membership role is not part of M6; organization financial access uses the existing OWNER, ADMIN, MANAGER, and STAFF roles with explicit permissions.
