# M6-05 Payment Recording and Allocation

## Financial record model

`Payment` stores the positive JMD amount, organization/customer scope, manual method, method-specific evidence, recorder membership, and recording time. Cash receipt numbers and bank transfer receiving accounts/references have separate API and database fields. PostgreSQL validates the canonical evidence identity: cash uses normalized receipt number; transfers use normalized receiving account plus normalized reference. Normalization trims and removes whitespace and folds case. New bank transfers require a receiving account. Transfers created before account capture remain readable with an unknown account and conservatively block a new same-organization transfer with the same normalized reference. Evidence is unique by organization and canonical method-specific identity.

Payment state is derived from append-only `PaymentLifecycleEvent` rows. Every payment has one `RECORDED` event and may have one `VERIFIED` and one `REVERSED` event. Verification records its actor and timestamp; `selfVerification` is derived from the verifier/recorder identity and checked by a database trigger. Cash and bank transfer payments both start pending verification.

`PaymentAllocation` stores a positive amount assigned to an issued invoice. `PaymentAllocationReversal` appends a full reversal for an allocation. Payment balances and invoice outstanding amounts are derived from allocations less their reversals. Reversed payments have no active allocation and cannot be allocated again. No customer balance counter is stored.

`PaymentCommandReceipt` binds an organization-scoped idempotency key to command type, actor, request hash, and payment. Replaying the same command returns its payment; reusing the key with a different actor, type, or payload conflicts.

All payment values use PostgreSQL `DECIMAL(34,2)`, matching M6 invoice capacity and exact JMD cents. Allocation checks and derived balances use integer cents (`bigint`) so the full 34-digit decimal capacity is exact; Prisma Decimal is used only to bind and serialize database values.

## API

All routes require authenticated, active membership in the path organization. Write routes require an `Idempotency-Key` UUID.

| Method and route                                                          | Permission         | Purpose                                                                                               |
| ------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `POST /organizations/:organizationId/payments`                            | `PAYMENT_RECORD`   | Record cash receipt number or bank transfer receiving account/reference; remains pending verification |
| `POST /organizations/:organizationId/payments/:paymentId/verify`          | `PAYMENT_VERIFY`   | Append verification event                                                                             |
| `POST /organizations/:organizationId/payments/:paymentId/allocations`     | `PAYMENT_ALLOCATE` | Allocate verified funds across issued invoices                                                        |
| `POST /organizations/:organizationId/payments/:paymentId/reverse`         | `PAYMENT_REVERSE`  | Append reasoned reversal and unwind active allocations                                                |
| `GET /organizations/:organizationId/payments`                             | `PAYMENT_READ`     | Paginated organization-scoped payments                                                                |
| `GET /organizations/:organizationId/payments/:paymentId`                  | `PAYMENT_READ`     | Payment, event history, allocations, and derived balance                                              |
| `GET /organizations/:organizationId/payments/invoices/:invoiceId/balance` | `PAYMENT_READ`     | Invoice gross, allocated, and outstanding values                                                      |

OWNER and ADMIN have all payment permissions. MANAGER may read, record, verify, and allocate but cannot reverse. STAFF may read and record only. `INVOICE_READ` is independent of every payment permission.

OWNER and ADMIN may self-verify if permitted. MANAGER may verify only another member's payment. STAFF cannot verify. Missing permission, inactive user, inactive organization, or inactive membership denies the operation.

## Transaction and database integrity

Payment commands take locks in this order: organization `FOR UPDATE`, the shared payment-ledger advisory lock, payment rows by UUID, invoice rows by UUID, acting membership `FOR SHARE`, then user `FOR SHARE`. This serializes all payment commands within an organization, blocks invoice issuance's organization `FOR KEY SHARE` while balances are checked, and avoids invoice/payment lock cycles. The coarse organization lock favors correctness over write throughput.

Composite foreign keys constrain payment/customer/invoice references to the same organization, customer, and currency. Checks reject nonpositive amounts and non-JMD values. Database triggers enforce append-only history, verified-only allocation, complete allocation reversal, payment amount conservation, invoice allocation capacity, and one-way lifecycle transitions. The command transaction includes all event, allocation, reversal, and idempotency writes so a failure rolls them all back.

## Scope and activation

The API records manual cash and bank transfer evidence only. It does not connect a payment gateway, create credit notes or statements, or add payment screens. Invoice issuance and sales depletion activation remain controlled by their existing default-off flags.
