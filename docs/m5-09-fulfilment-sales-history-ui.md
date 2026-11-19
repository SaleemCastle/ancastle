# M5-09 fulfilment and sales history UI

## Routes and workflow

- `/app/orders/:orderId` shows commercial snapshots separately from physical
  order quantities and fulfilment progress.
- Select a farm from the user's current organization/farm context to inspect
  eligible sources and that farm's immutable posting history. A separate
  command is required for each farm.
- For produce, source choices use eligible catalog-linked produce items and the
  M3 farm inventory read model. For poultry, source choices use active CAT
  flock eligibility joined to M5-POP flock metrics. Birds are never InventoryItems.
- Partial poultry EACH and Decimal produce quantities can be posted together
  in one farm-scoped command. The server revalidates everything at posting.
- `/app/customers/:customerId` displays the existing M5-07 tenant-scoped order
  history, including ordered, net purchased and remaining quantities and the
  commercial snapshots permitted by `order:read`.

## Authorization and redaction

Farm choices come from the fresh application context; arbitrary organization or
farm IDs are never trusted by a server action. Each mutation reloads that
context, checks `order:read` plus `fulfilment:post` or `fulfilment:reverse`, and
calls the existing API whose guards recheck active membership, permissions and
farm assignment. Source reads use the farm-scoped stock, flock and catalog
eligibility APIs. Restricted operational details are not included in customer
purchase history. `order:read` retains the ADR-approved whole-order commercial
snapshot visibility, including STAFF; this does not grant access to another
farm's source details.

## Availability semantics

Availability is a point-in-time indication from the M3 movement-derived stock
read and M5-POP `liveBirdCount`. It is never derived from order quantity,
reserved during editing, or described as reserved after confirmation. Mortality
is not changed by the UI. Atomic posting remains authoritative and concurrent
stock or flock changes are reported for refresh/review.

## Posting, idempotency and errors

The form validates with the shared `postFulfilmentSchema`; the server action
revalidates the payload and current access. Each intended command gets a UUID
idempotency key. After a timeout or unknown response, the UI retains the exact
payload and key and offers retry of that same command or refresh of authoritative
order/source state. It does not create a new command automatically. The shared
management API helper preserves custom headers such as `Idempotency-Key` while
overriding authorization with the current server-side token.

Validation, permission, missing-resource and known conflict errors are shown as
safe messages. Unknown network outcomes remain explicitly unknown. The API
continues to enforce ordering, eligibility, stock/population availability and
idempotency receipt/replay.

## History and reversals

History comes from `GET /organizations/:organizationId/farms/:farmId/fulfilments`
and includes immutable source and quantity snapshots, event timestamps,
operator, references, notes and posting/reversal links. Reversal is available
only with `fulfilment:reverse`; the UI asks for a reason and explicit full-batch
confirmation. It creates a distinct idempotent reversal command. Partial
reversals, returns and edits/deletes of posted records are not supported.

## Real-API verification

The browser regression uses the existing owned-server runner, which creates a
disposable PostgreSQL database and shuts down API, auth proxy, Next and the
database in `finally` cleanup. To exercise real fulfilment posting locally:

```powershell
$env:ANCASTLE_E2E_SALES_FULFILMENT = '1'
node apps/web/e2e/run-poultry.mjs playwright.sales-orders.config.ts e2e/orders.browser.ts -g "posts and reverses mixed partial fulfilment"
Remove-Item Env:ANCASTLE_E2E_SALES_FULFILMENT
```

The runner forces `SALES_FULFILMENT_ENABLED=false` by default and permits the
opt-in only for this disposable test server. No production deployment setting
is changed. The test checks authorized and unassigned farm access, mixed
partial posting, inventory ISSUE effects, flock sale depletion, net remaining
quantities, immutable posting/reversal history, restored ledger availability
and customer purchase history. It also simulates a lost posting response after
the API commits, confirms that the UI labels the outcome unknown, retries the
same key and payload, and verifies the idempotency receipt avoids a second
inventory or flock effect.

The audited browser run starts inventory at **20.000 KG** and poultry at **20
birds**. A **1.250 KG** produce allocation persists as a `-1.250` KG `ISSUE`
movement and yields **18.750 KG** from the movement-derived balance; the API
serializes that decimal as `18.75`. The `2 EACH` poultry allocation persists as
two sale-depletion birds and yields **18** live saleable birds. The full-batch
reversal appends `+1.250` KG as an `ADJUSTMENT` and a two-bird depletion reversal,
restoring persisted balances to **20.000 KG** and **20** birds. The test queries
the disposable database for those persisted rows, links, and single POST/REVERSE
command receipts in addition to checking the read APIs. The former shorthand
report that produce went from 20 to 18 was inaccurate; it was the poultry count
that changed by two.

The browser workflow also submits a fractional poultry quantity and verifies
local shared-contract validation creates no event. It then uses the test-only
proxy to return a 422 field error and a 409 without forwarding either command,
verifying validation feedback, conflict feedback/refresh, and no write. The API regression independently exercises
actual concurrent different-payload key conflicts, order-version races,
availability checks and atomic rollback. This separates UI recovery coverage
from backend concurrency proof.

## Remaining risks

- Production depletion activation remains disabled and is not part of M5-09.
- Availability can change between read and submit; API conflicts require a
  refresh and operator review.
- A network outcome cannot be known client-side; safe recovery depends on the
  API's unchanged idempotency receipt/replay behavior.
- Commercial history intentionally does not infer invoices, payments, paid
  amounts, receivables or balances.
