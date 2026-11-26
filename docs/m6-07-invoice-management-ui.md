# M6-07 Invoice Management UI

## Routes and navigation

- `/app/invoices` lists organization invoices, provides server-side filters and pagination, and displays receivables summary metrics when the active membership has `receivable:read`.
- `/app/invoices/[invoiceId]` shows the immutable invoice and customer snapshots, source references, terms, lines, tax policy metadata, receivables, payment allocations, and lifecycle history.
- The primary navigation shows Invoices only when the active organization context includes `invoice:read`. Organization switching is handled by the existing application shell; every server-rendered request reloads the selected organization context.

## Component architecture

- The pages use `ManagementPage`, `ApplicationShell`, `managementApi`, and the shared UI button styles already used by the sales and inventory screens.
- `IssueInvoicePanel` provides farm-scoped eligible fulfilments, an accessible native confirmation dialog, an explicit confirmation checkbox, pending-state duplicate-submit prevention, and stable command keys retained in session storage for retries.
- Loading skeletons are provided by each route's `loading.tsx` file. List and details errors provide retry links. The list has separate desktop table and mobile card layouts.
- `lib/management/finance.ts` formats decimal-string JMD amounts with `BigInt` grouping and formats calendar dates without treating stored DATE values as UTC instants.

## API integrations

- Invoice list/detail/history: `GET /organizations/:organizationId/invoices`, `/:invoiceId`, and `/:invoiceId/history`.
- Historical customer selector options: `GET /organizations/:organizationId/invoices/customers`, sourced from invoice billing snapshots.
- Receivables rows and organization totals: `GET /organizations/:organizationId/receivables/invoices` and `/receivables/summary`.
- Payment allocation detail: `GET /organizations/:organizationId/payments/invoices/:invoiceId/allocations`.
- Eligible issuance sources and status: `GET /organizations/:organizationId/invoices/eligible-fulfilments/:farmId` and `/issuance-status`.
- Issuance: `POST /organizations/:organizationId/invoices/fulfilments/:fulfilmentId/issue` with a stable `Idempotency-Key` header.

Invoice list and receivables filters are applied by the API: customer, invoice/customer search, issue-date range, due-date range, settlement status, overdue state, sort field/direction, and pagination. Issue dates are interpreted in `America/Jamaica`; due dates remain calendar dates.

## Permission handling

- Invoice list, invoice snapshots, history, and customer snapshot choices require `invoice:read`.
- Summary and settlement/outstanding amounts require `receivable:read`. Users without that permission see restricted labels and no receivables aggregates.
- Payment allocation entries require `payment:read`; their endpoint independently verifies the permission and organization ownership.
- Issuance controls appear only with `invoice:issue`, `order:read`, and `fulfilment:read`. Eligible sources also pass the existing farm access guard. The server rechecks permissions, membership, source state, and activation before issuing.
- The issuance feature gate is observed through an authorized status endpoint and is never enabled by the UI. When disabled, the page explains why issuance is unavailable.

## Financial precision and historical data

- Monetary values remain decimal strings from API through display. Formatting uses integer `BigInt` grouping and never converts a financial amount to JavaScript `Number`.
- Invoice totals, receivable balances, settlement state, overdue state, and organization summaries are calculated by the backend. Summary amounts are not derived from the current page.
- Customer billing details and line descriptions, quantities, units, and unit prices come from invoice snapshots. Current customer/product records are not substituted.
- Tax policy reference/version and treatment state are displayed from the invoice record. The current API does not provide a separate calculated tax amount; the UI states that tax has not been calculated.

## Testing evidence

Focused contract, formatting, receivables integration, API regression, browser, and repository quality-check results are recorded in the implementation report. The browser workflow uses only a disposable test database. Invoice issuance is enabled there only when `ANCASTLE_E2E_INVOICE_ISSUANCE=1`; this does not alter production gates.

Screenshots produced by the real browser workflow are stored under `docs/screenshots/`.

## Known limitations

- The eligible-fulfilment selector currently receives the 100 most recent eligible fulfilments for the selected authorized farm; it does not yet paginate beyond that set.
- Historical customer selector choices are capped at 500 distinct invoice customers.
- No PDF/print export, credit-note history, payment recording, or payment allocation workflow is included, consistent with this card's out-of-scope items.
- The API exposes tax policy metadata but no separately calculated tax amount or subtotal field. The detail page identifies the stored invoice total and the current not-calculated tax state.
