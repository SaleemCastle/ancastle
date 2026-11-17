# M5-08 sales order management UI

## Routes and workflows

- `/app/orders` lists organization-scoped orders with search, customer ID,
  commercial state, fulfilment progress, bounded pagination, JMD totals and
  CASH/CREDIT terms.
- `/app/orders/new` creates a DRAFT using active M2 customers and M5-CAT
  poultry/produce products.
- `/app/orders/:orderId` shows immutable customer/product/price snapshots,
  ordered, net fulfilled and remaining quantities, commercial terms, and
  paginated order event history.
- `/app/orders/:orderId/edit` amends DRAFTs using the API's expected order
  version and stable line operations.

Creation and editing allow multiple lines. Product choices can be searched;
the UI never models poultry as inventory. Agreed JMD unit prices are line
inputs because M5-CAT has no catalog price. The form's exact decimal total is a
preview; the order returned by the server owns saved prices, line amounts and
total. CASH/CREDIT and credit term days are commercial intent only.

Confirmation presents the current order summary and explains that terms freeze
and no stock or birds are reserved. Cancellation requires a reason and explains
that previous fulfilled quantities remain in history. This UI does not create
fulfilments, reverse them, calculate due dates, or display invoice/payment
states or financial balances. Order creation is intentionally not retried after
a network error because the API has no create idempotency contract. If the
server or browser loses the response, the form reports that the outcome is
unknown, disables another submission, and links to the order list for recovery.
The user can inspect the order list before deciding whether another draft is
needed.

## Authorization and data boundaries

The order navigation appears for `order:read`. The list/detail/event pages check
that permission against the active organization context. Create/edit require
`order:manage`; confirmation and cancellation use their independent
`order:confirm` and `order:cancel` permissions. The backend remains authoritative
for every request and rejects stale order versions and invalid lifecycle
transitions. Successful create/edit/confirm/cancel actions refresh server data;
the action buttons remain disabled while requests are pending and after a
successful one-shot lifecycle transition. The create form also has a synchronous
in-flight guard. Server actions reuse the existing origin check, selected-tenant
context, shared Zod contracts and safe API error map.

Order details are fetched with the shared strict detail contract, then the page
removes `sourceDetails` before rendering or passing commercial props. The UI
never displays farm/flock/source allocations. Organization identity comes from
fresh application context, not a body field supplied by the browser.

## API dependencies and validation

The UI uses existing organization-scoped APIs:

- `GET /customers`, `GET /sales-products` for bounded active choices;
- `GET /orders` for filters, summary and pagination;
- `POST /orders`, `PATCH /orders/:orderId` for draft lifecycle;
- `GET /orders/:orderId`, `GET /orders/:orderId/events` for detail/history;
- `POST /orders/:orderId/confirm` and `/cancel` for lifecycle transitions.

All request/response DTOs use `@ancastle/validation` and `@ancastle/types`.
Quantities and prices remain decimal strings. The preview uses decimal string
arithmetic and the approved per-line half-up rounding; saved amounts are
displayed from API responses. Local schema errors are rendered safely; 401,
403, 404, validation and 409 conflicts use fixed messages and never display
upstream internals. A stale version asks the user to reload and review the
current draft.

Customer/product search requests are bounded to 100 results per query; users can
refine the visible name/code search to find another choice; the selector shows
this limit. Each request is sequenced so a late response cannot replace results
from a newer search. The order list uses the API's customer
ID filter alongside state, progress and search filters. Event history is
paginated at 20 events per page.

## Responsive behavior

The shared application shell adds an order navigation link for readers. Lists
use the existing horizontally scrollable table convention. Draft forms stack
on narrow viewports and use responsive grids on wider screens; details retain a
minimum-width table inside a local horizontal scroller. The real-API browser
workflow checks a 390px viewport for document overflow.

## Browser and test verification

The owned-server Playwright runner creates a disposable migrated PostgreSQL
database, starts the real API, auth proxy and production Next.js server on
reserved ports, then closes each child through IPC and waits for exit. The
focused browser workflow creates mixed poultry/produce catalog fixtures through
the API, creates a draft in the UI, edits quantity/price and adds a line,
confirms the order, verifies CREATED/AMENDED/CONFIRMED history, then switches to
STAFF and verifies read-only actions are absent. It also checks required CREDIT
term validation, cancellation and its event, and simulates a lost browser
response after the real server action has committed a draft; the UI directs the
user to the list, where the committed order is found without a second POST. It
reports zero owned servers remaining after completion.

Focused Vitest coverage exercises shared contract handling, exact display
rounding, poultry/produce identity handling, mixed order action payloads,
CASH/CREDIT, draft amendment versions, confirmation/cancellation routes,
permission and origin rejection, safe version conflicts, and editor content.

Verification on the feature branch (latest full sequential rerun):

| Command                                                                         | Result                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sequential workspace regression (`pnpm test --concurrency=1 -- --maxWorkers=2`) | **Passed, exit 0**: API 518 passed (43 files), validation 180 passed, web 130 passed; 828 total. Turbo 3m3.161s; API Vitest 144.70s, validation 4.38s, web 22.56s. |
| Focused customer/supplier API integration rerun on a disposable database        | 2 files, 72 passed, 0 failed; Vitest 26.91s                                                                                                                        |
| Focused sales-order/catalog API integration run on a disposable database        | 2 files, 23 passed, 0 failed; Vitest 29.89s                                                                                                                        |
| Focused web tests                                                               | 22 passed, 0 failed                                                                                                                                                |
| Focused shared sales validation tests                                           | 14 passed, 0 failed                                                                                                                                                |
| Owned-server real-API Playwright workflow                                       | 1 passed; 18.7s test, 45.415s runner; all child processes exited 0 and `ownedServersRemaining=0`                                                                   |
| `pnpm format:check`                                                             | Exit 0                                                                                                                                                             |
| `pnpm lint`                                                                     | Exit 0, 0 warnings                                                                                                                                                 |
| `pnpm typecheck`                                                                | Exit 0                                                                                                                                                             |
| `pnpm build`                                                                    | Exit 0; 4 workspace tasks succeeded; Next.js production build generated all application routes                                                                     |
| `git diff --check`                                                              | Exit 0                                                                                                                                                             |

An earlier aggregate run timed out in customer/supplier `beforeEach` setup and
produced cascading 401 assertions. The full sequential regression and focused
reruns subsequently passed; the exact database operation that stalled in the
earlier run could not be isolated. If the setup timeout recurs in CI, capture the
first stalled database operation before changing test timeouts or fixture
lifecycle behavior.

## Known limitations

- Choice search returns at most 100 matches per query; it is refined by search
  text rather than paginated within the selector.
- The UI displays server-returned fulfilment progress but does not provide
  source allocations or any fulfilment mutation.
- New order creation has no idempotency receipt. After a lost response, the user
  must inspect the order list before attempting another create; the UI blocks a
  repeat submission when it can detect the uncertain outcome.
- The JMD preview mirrors approved rounding for convenience; the API response
  remains authoritative and the UI does not claim catalog pricing or stock
  availability.

No migration, production depletion activation, invoice/payment behavior,
customer returns or unrelated refactoring is included.
