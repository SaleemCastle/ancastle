# M4-11 poultry integration coverage audit

Audit date: 2026-11-11. Branch: `m4-11/poultry-integration-audit`.
Scope: the implemented M4-01 through M4-10 behavior and its existing M1/M3 foundations.
[Trello acceptance criteria](https://trello.com/c/yP1saG3M).

## Phase 1: baseline matrix

This matrix was produced before adding tests. **Complete** means the relevant
boundary is asserted by existing tests, including reused foundation coverage;
it does not mean every possible variation has been tested. **Partial** identifies
a specific uncovered high-risk integration path, rather than a missing test count.
Evidence identifiers resolve to exact file/test names below.

| #   | Criterion                                                         | Existing evidence  | Baseline | Missing risk                                                                                                                                                                                                                                           | Additional test justified?   |
| --- | ----------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | Cross-organization flock isolation                                | A1, A2, F1, T1     | Complete | None. Foreign IDs, scoped lists/counts and organization permissions are exercised.                                                                                                                                                                     | No; reuse.                   |
| 2   | Unassigned and foreign farm access                                | A3, A4, T2, W1     | Complete | None. Flock, mortality and feed routes reject inaccessible farms.                                                                                                                                                                                      | No; reuse.                   |
| 3   | Flock association with the correct organization/farm              | F2, A4             | Complete | None. Composite ownership constraints and payload-ID rejection are covered.                                                                                                                                                                            | No; reuse.                   |
| 4   | Mortality organization/farm/flock isolation                       | A1, A3, M1, P1     | Partial  | Two valid populated flocks in one authorized farm are not compared through the API; a reversal call using another permitted flock/farm is not exercised.                                                                                               | Yes: G1 and G2.              |
| 5   | Feed organization/farm/flock isolation                            | A1, A3, I1, I2     | Partial  | Valid neighbouring-flock histories/totals and a wrong-permitted-farm feed compensation are not exercised.                                                                                                                                              | Yes: G1 and G2.              |
| 6   | Live population derived from mortality, including reversals       | M2, M3, A5         | Complete | Arithmetic, cancellation, replacement, exact exhaustion and current-ledger semantics are covered. Same-farm scope is addressed under #4.                                                                                                               | No additional formula tests. |
| 7   | Mortality cannot exceed available population                      | M3, M4, A6         | Partial  | Concurrent mortality posts are covered, but a starting-population edit racing mortality is not.                                                                                                                                                        | Yes: G3.                     |
| 8   | Append-only mortality history                                     | P2, P3, A4         | Partial  | Update/delete/truncate and reversal persistence are covered; paginated public history has not been shown to retain both original and reversal.                                                                                                         | Yes: G2, for readback only.  |
| 9   | Append-only feed usage history                                    | I3, I4, A4         | Partial  | Mutation protection and compensation are covered; paginated public history has not been shown to retain both original and reversal.                                                                                                                    | Yes: G2, for readback only.  |
| 10  | Atomic M3 inventory deduction for feed usage                      | I5, I6, A5, S1     | Complete | None. Exactly one matching negative ISSUE, linked audit identity and transaction rollback are asserted.                                                                                                                                                | No; reuse.                   |
| 11  | Insufficient-stock rollback                                       | I7, A5, S2, W2     | Complete | None. Failed consumption leaves no partial FeedUsage or inventory entry and preserves stock; concurrent consumption is covered.                                                                                                                        | No; reuse.                   |
| 12  | Independent operations across permitted farms in one organization | T2, M1, W1, W2     | Partial  | M1 proves multiple assignments, metrics cover two-farm mortality, and browser switching reaches an empty farm. No populated poultry/feed workflow uses the same assigned identity in both farms and compares histories, metrics and shared-item stock. | Yes: G1.                     |
| 13  | Poultry permission boundaries                                     | A3, A5, T3, T4, W3 | Complete | None within the current policy. STAFF can read/post but cannot manage definitions/lifecycle; farm access is separate and permissions are organization-specific.                                                                                        | No; reuse.                   |

## Existing evidence registry

### Poultry HTTP integration

File: [flocks.integration.spec.ts](../../apps/api/src/modules/poultry/flocks.integration.spec.ts).

- **A1:** `hides foreign flock existence on detail, update, lifecycle, history and posting`.
- **A2:** `filters existing maturity states before scoped counts/pagination, independently of lifecycle`.
- **A3:** `requires organization capability and a separate farm assignment for all workflows`.
- **A4:** `rejects malformed/shared contract bypasses and offers no destructive history routes`.
- **A5:** `posts mortality/feed as STAFF, preserves audit fields and exposes current ledger metrics independently of age date`.
- **A6:** `validates each one-date PATCH against persisted counterpart and protects the mortality baseline`.
- Existing lifecycle coverage also includes `supports assigned manager create/list/detail/update and idempotent lifecycle without deleting history` and `rejects inactive membership, user, organization, farm and assignment states`.

### Derived metrics and mortality

File: [flock-metrics.integration.spec.ts](../../apps/api/src/modules/poultry/flock-metrics.integration.spec.ts).

- **M1:** `keeps farm/flock/organization history isolated on metrics and mortality operations`.
- **M2:** `derives corrected mortality, live population and item-specific feed from history in a scoped snapshot`.
- **M3:** `rejects over-mortality, allows the exact remaining population, and restores headroom after reversal`.
- **M4:** `serializes simultaneous mortality so only one request can consume the remaining population`.

The existing [flock-metrics.spec.ts](../../apps/api/src/modules/poultry/flock-metrics.spec.ts)
also defines placement-day behavior, decimal rounding, completed calendar
days/weeks, maturity-date boundaries and invalid histories. None of those formula
tests needs copying into this audit.

### Persistence and immutable histories

File: [flock.persistence.spec.ts](../../apps/api/src/database/flock.persistence.spec.ts).

- **F1:** `supports existing farm context scoping without exposing another farm or tenant`.
- **F2:** `rejects cross-organization and missing farm ownership on creation and update`.

File: [mortality-event.persistence.spec.ts](../../apps/api/src/database/mortality-event.persistence.spec.ts).

- **P1:** `rejects cross-tenant/cross-farm flock links and missing actor identity` and `rejects a real actor who belongs only to another organization`.
- **P2:** `blocks updates, deletion and truncation without changing posted history`.
- **P3:** `appends a full reversal and replacement while preserving the original event` and `rejects partial, foreign-flock, missing and self reversals`.
- `persists whole-bird mortality with audit identity, timestamps and optional metadata` additionally proves mortality leaves starting population and inventory unchanged: birds are not inventory items.

File: [feed-usage.integration.spec.ts](../../apps/api/src/modules/poultry/feed-usage.integration.spec.ts).

- **I1:** `rejects foreign farm/flock/item and non-feed items without posting either side`.
- **I2:** `enforces direct persistence scope, matching movement semantics and organization-safe actor attribution`.
- **I3:** `protects posted feed history and its unique linked inventory movement`.
- **I4:** `fully compensates once through append-only usage and inventory history`.
- **I5:** `records positive consumption and exactly one matching negative movement with precise derived stock`.
- **I6:** `rolls back the complete operation on either inventory or feed persistence failure`.
- **I7:** `retains the M3 negative-stock policy and advisory lock across concurrent feed posts`.

### Reused M1 and M3 foundations

- **T1:** [organization-isolation.integration.spec.ts](../../apps/api/src/modules/authorization/organization-isolation.integration.spec.ts): `scopes lists and complex filters to the selected verified organization`, `returns identical not-found responses for inaccessible and nonexistent resource IDs`, and `does not carry administrator permissions from A into B`.
- **T2:** [farm-access.integration.spec.ts](../../apps/api/src/modules/authorization/farm-access.integration.spec.ts): `supports single and multiple assigned farms within one organization`, `keeps farm selection independent from write permissions`, `scopes operational records by both selected farm and organization despite OR filters`, and `keeps concurrent organization/farm selections independent`.
- **T3:** [authorization.service.spec.ts](../../apps/api/src/modules/authorization/authorization.service.spec.ts): `enforces flock read/manage/mortality/feed capabilities for %s` and `allows owners every defined permission`.
- **T4:** [farm-access.guard.spec.ts](../../apps/api/src/modules/authorization/farm-access.guard.spec.ts): `uses verified organization context and route selection, ignoring payload claims` and `does not retain stale farm context when access is rejected`. Authentication, inactive-state, spoofed-context and revocation tests already exist in M1 and are not duplicated here.
- **S1:** [inventory-stock.integration.spec.ts](../../apps/api/src/modules/inventory/inventory-stock.integration.spec.ts): `derives exact fractional stock from immutable movements` and `serializes concurrent outbound movements for the same stock position`; [inventory-movement.persistence.spec.ts](../../apps/api/src/modules/inventory/inventory-movement.persistence.spec.ts): `rejects cross-organization farm and inventory ownership`.
- **S2:** [farm-inventory.integration.spec.ts](../../apps/api/src/modules/inventory/farm-inventory.integration.spec.ts): `rejects a movement that would produce negative stock without persisting it` and `enforces farm assignment and tenant isolation without exposing inventory data`; stock service: `rejects a movement that would produce negative stock`.

### Existing web workflows

- **W1:** [shell.spec.ts](../../apps/web/e2e/shell.spec.ts): `selects among multiple assigned farms and retains the choice across reload/navigation`, `switches organizations without carrying stronger permissions or another organization’s farm`, `rejects client URL/DOM manipulation, foreign, unassigned and inactive farm IDs`, and `revalidates revoked farm grants, farm lifecycle and inactive memberships on each request`.
- **W2:** [poultry.browser.ts](../../apps/web/e2e/poultry.browser.ts): `posts mortality and feed with authoritative refresh, safe reset and farm-scoped history`. Covers real posting, stock error preservation, successful reset, refreshed metrics/stock, history pagination, switching to an empty farm and revoked access. `keeps lifecycle and expected maturity independent with paginated maturity filters` covers current maturity filtering and responsive presentation.
- **W3:** [management.spec.ts](../../apps/web/e2e/management.spec.ts): `manages farm flocks through real APIs with responsive views and read-only access`. Covers create/edit/close/reactivate and STAFF denial of definition/lifecycle management. STAFF is intentionally allowed operational posting, so read-only definition access is not confused with a no-posting role.

## Phase 2: implemented gap closure

Extended only the existing poultry HTTP/PostgreSQL suite with three tests:

1. **G1 — populated scope separation:** `keeps populated flocks, histories and feed stock independent across two assigned farms`.
   Use the same assigned STAFF identity in two farms, plus a neighbouring flock
   in the first farm. Give each flock distinct mortality/feed postings, verify
   exact history identities and counts, compare detail metrics and scoped lists, and verify
   shared feed-item stock combines usage only within its farm. Covers #4, #5 and #12.
2. **G2 — compensation scope and visibility:** `keeps scoped originals and reversals visible in paginated poultry histories`.
   Reject reversal attempts through another otherwise permitted farm/flock without
   compensating either ledger, then invoke the existing domain reversal methods
   in the correct scope. Read both history pages through HTTP, verify reversal
   links, restored population/feed totals and compensating ADJUSTMENT stock.
   No reversal endpoint or UI is introduced. Covers #4, #5, #8 and #9.
3. **G3 — shared population lock:** `serializes a starting-population edit against mortality posting`.
   Race a reduction below a simultaneous mortality count and require exactly one
   operation to succeed. Assert the losing operation reports over-mortality and
   persisted history/derived population match the winning order. Covers #7.

No additional framework, authentication matrix, fixture cleanup strategy, migration
or product workflow is needed. Existing temporary-database isolation preserves
append-only records and database protections during cleanup.

All six partial baseline criteria (#4, #5, #7, #8, #9 and #12) now have the
additional regression coverage identified in the matrix. The other seven criteria
reuse existing tests. No production defect was exposed, so production modules,
API contracts, authorization, persistence and database/test runners are unchanged.

## Verification and outcome

- Focused poultry integration/persistence: **42 tests passed in 5 files**.
  Command: `pnpm --filter @ancastle/api test -- src/modules/poultry/flocks.integration.spec.ts src/modules/poultry/feed-usage.integration.spec.ts src/modules/poultry/flock-metrics.integration.spec.ts src/database/flock.persistence.spec.ts src/database/mortality-event.persistence.spec.ts`.
- `pnpm format:check`: passed.
- `pnpm lint`: passed (API: zero warnings/errors; web: passed).
- `pnpm typecheck`: passed for all four packages.
- `pnpm test`: passed; API **412**, web **109**, validation **148**
  (validation results reused from the existing Turbo cache).
- `pnpm build`: passed for all four packages.
- `git diff --check`: passed.
- `git status --short`: only the existing poultry integration suite is modified
  and the new audit document is untracked; no other source files changed.

The full test run emitted Turbo's existing missing-output warnings for API/web
test tasks; it exited successfully. No test timeout or assertion was weakened.

Changed files are this audit and `apps/api/src/modules/poultry/flocks.integration.spec.ts`.
No feature, migration, dependency or browser workflow was changed.

Remaining verification limits: the referenced browser workflows were inspected,
not rerun; the root test gate runs Vitest rather than Playwright. CI results cannot
be established locally without the commit/push explicitly excluded by this task.
The population race asserts both valid serialized outcomes under concurrent HTTP
requests; it does not force a particular transaction scheduling order. No remaining
uncovered high-risk path was identified within the audited criteria.
