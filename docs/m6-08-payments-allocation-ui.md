# M6-08 Payments and Allocation UI

## Routes and components

- `/app/payments?organization=<id>` shows the active organization's payments, balances and available actions. Customer filtering and pagination run on the server. Customer selection uses a paginated name/code search.
- `/app/payments/<paymentId>?organization=<id>` shows evidence, payment and allocation balances, append-only lifecycle history and allocation reversals.
- `CustomerPicker`, `PaymentCommandDialog`, `RecordPayment`, `PaymentDetailActions` and the payment display components reuse the workspace shell, buttons and finance formatting. Native modal dialogs support keyboard navigation, Escape and focus return. The payment list adapts to a single-column layout on small screens.

## API and workflow

| Operation              | API under `/organizations/:organizationId`  | Permission         |
| ---------------------- | ------------------------------------------- | ------------------ |
| List and read          | `GET /payments`, `GET /payments/:paymentId` | `payment:read`     |
| Select a customer      | `GET /customers`                            | `customer:read`    |
| Record                 | `POST /payments`                            | `payment:record`   |
| Verify                 | `POST /payments/:paymentId/verify`          | `payment:verify`   |
| Find eligible invoices | `GET /receivables/invoices`                 | `receivable:read`  |
| Allocate               | `POST /payments/:paymentId/allocations`     | `payment:allocate` |
| Reverse                | `POST /payments/:paymentId/reverse`         | `payment:reverse`  |

1. Record the customer, JMD amount, Jamaica transaction date, and either cash receipt number or bank receiving account and transfer reference. Confirm the entered evidence. New records remain pending.
2. Verify after confirming receipt of funds. OWNER and ADMIN can confirm their own payments when granted the permission. MANAGER can verify another member's payment. STAFF has no verification permission.
3. Allocate verified funds to one or more issued invoices. The picker uses outstanding receivables for the payment's organization, customer and currency. Partial allocations leave the remainder available for later allocation.
4. OWNER and ADMIN can reverse with the reversal permission, confirmation and a reason. The backend unwinds every active allocation atomically and the detail page shows the reversal and prior allocations.

## Authorization and error handling

Payment reads and screen actions use the selected organization's fresh permissions. Server actions recheck their required permissions and the API enforces membership, permission, evidence uniqueness, state and allocation capacity. Payment resources are looked up inside the verified organization. The existing invoices and receivables routes retain their separate permissions and response contracts.

Commands send a UUID idempotency key. The dialog prevents overlapping submissions and retains the key and exact command in memory for transport retries. Session storage retains the key and a payload fingerprint scoped by user, organization, command and payment. After a reload, re-entering the original values reuses that key. Review the ledger before clearing an unresolved attempt. Sensitive form values are kept out of session storage. Definitive duplicate evidence and balance conflicts have actionable messages. Reloading allocation balances clears the old draft so current values can be reviewed before resubmission.

## Financial precision and migration

Amounts cross the network as decimal strings. The UI formats the integer part with `BigInt` and compares amounts in integer cents. The API and PostgreSQL are authoritative for persisted balances. The immutable `transactionDate` preserves the entered Jamaica calendar date separately from the API recording timestamp. Apply migration `20261126120000_payment_transaction_date` before running the updated API. Older callers may omit the date, and the UI shows the recording date for rows with no transaction date. Updated responses also include the current customer name and a flag indicating whether the current membership recorded the payment. Use the updated shared validation schema for strict response parsing. Legacy bank transfers can have a missing receiving account.

## Verification

- Web unit coverage includes permissions, maximum-value formatting, duplicate invoice targets and allocation limits.
- Shared validation tests cover the date contract and earlier request compatibility. API integration tests cover the date persisted under idempotency, membership-relative projection and upgrade of existing payments.
- Run `pnpm build` at the repository root, then run `node e2e/run-poultry.mjs playwright.payments.config.ts` from `apps/web`. Set `ANCASTLE_E2E_INVOICE_ISSUANCE=1` and `ANCASTLE_E2E_SALES_FULFILMENT=1` for invoice fixtures in the runner's disposable database.
- Browser scenarios cover cash and transfer evidence, lost response and replay, duplicate evidence, verification authorizations, an open-dialog role change, partial and full allocations, stale outstanding balances, reversal effects, organization isolation, pagination and keyboard focus.

## Screenshots

- [Desktop payment list](screenshots/m6-08-payments.png)
- [Mobile payment list](screenshots/m6-08-payments-mobile.png)
- [Multi-invoice allocation](screenshots/m6-08-payment-allocation.png)
- [Reversal and allocation history](screenshots/m6-08-payment-reversal.png)

## Known limitations

- The payment API offers customer filtering. Method, verification state, and date filters would require an API extension.
- A payment reference is its entered receipt or transfer reference. There is no separate human-readable payment number. Allocation history links use the invoice ID returned by the payment API.
- Customer names reflect the current customer record. Historical payment evidence, amounts and audit events are recorded on the payment.
- Recovery across reloads requires the same browser tab and available session storage. When a committed command changes eligibility, review the updated payment and allocation history. Ledger history and canonical evidence uniqueness support manual recovery when browser state is lost.
- Ledger event timestamps drive historical cutoffs. Invoice issuance and sales depletion require their separate deployment gates.
