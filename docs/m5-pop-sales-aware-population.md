# M5-POP Sales-Aware Flock Population v2

## Behavior

Flock population reads now report `startingBirdCount` (S), `cumulativeMortality` (M), `effectiveFulfilledBirdCount` (B), and `liveBirdCount = S - M - B`. B is derived from the append-only `FlockSaleDepletion` ledger as original postings less exact full reversals. It is not stored as a mutable flock counter and is never included in mortality. The existing mortality percentage remains `M * 100 / S`; feed usage and corrections do not affect B.

The shared API response uses the M5-02 v2 contract, with B required by strict validation. The existing `liveBirdCount` property name remains stable and now means birds remaining on farm. Web list/detail views label B separately and explain the new live count. No M5 fulfilment writer or sale depletion posting endpoint is enabled by this change.

## Persistence and compatibility

- No schema migration is required. M5-03 already provides immutable, scoped depletion and reversal rows.
- Existing M4 flocks have no depletion rows, so B is zero and their live count and mortality percentage remain unchanged.
- All population arithmetic uses integral PostgreSQL/Prisma decimal aggregates and integer outputs. Reads aggregate mortality and depletion in one SQL statement and use a repeatable-read transaction for a consistent flock snapshot.
- Mortality posting/reversal and baseline edits use the existing shared flock mutation lock. Any future depletion writer must acquire that same flock lock before inserting ledger effects, after command/order/definition locks and before stock locks, per M5-01/M5-LOCK.

## Deployment and rollback

This changes the meaning of `liveBirdCount` once depletion entries exist. Deploy the API and web client as a coordinated release behind the production write barrier: all consumers must understand required v2 B, and no fulfilment/depletion writer may be enabled until M5-05 has implemented the approved posting flow and every API/web instance is compatible. M5-POP itself does not enable or provide that writer. Confirm deployment has no older API or web instances before lifting the barrier.

Rollback is safe to the prior response semantics only while no effective depletion rows exist. After the first sale depletion is recorded, do not roll the API or web client back to a version that interprets `liveBirdCount` as S-M. Keep v2 reads and the depletion ledger, or first establish an approved forward recovery that preserves the v2 meaning. Do not delete or rewrite ledger history to facilitate rollback.

## Verification evidence

Prior implementation regression evidence:

- `pnpm format:check` — passed.
- `pnpm lint` — passed; API reported 0 warnings and 0 errors.
- `pnpm typecheck` — passed for all four workspace packages.
- `pnpm build` — passed for all four workspace packages. The first sandboxed attempt could not fetch the existing Google Fonts; rerunning with network access succeeded.
- `git diff --check` — passed.
- `pnpm --filter @ancastle/validation test -- --maxWorkers=2` — 8 files, 178 tests passed.
- `pnpm --filter @ancastle/web test -- --maxWorkers=2` — 13 files, 116 tests passed.
- `node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-lock-audit-verify.mts api --testTimeout=15000 --hookTimeout=30000` — isolated disposable PostgreSQL database; 41 files, 456 tests passed.
- `node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-lock-audit-verify.mts focused src/modules/poultry/flock-metrics.integration.spec.ts --testTimeout=15000` — isolated PostgreSQL; 7 tests passed, including genuine overlapping transactions confirmed through PostgreSQL lock-wait state.

The repository has no explicit Vitest timeout override in `apps/api/vitest.config.ts` or `apps/web/vitest.config.mts`; Vitest defaults are a 5,000 ms test timeout and 10,000 ms hook timeout. On this Windows host, the exact CI command `pnpm test` exited 1 after validation (178 tests) and web (116 tests) passed; the API had 456 passing tests, but three PostgreSQL cleanup hooks exceeded the default 10-second hook timeout under Turbo parallel load. `pnpm --filter @ancastle/api test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=30000` passed all 456 API tests across 41 files. No test timeout or worker configuration was changed in source.

The literal root command `pnpm test -- --maxWorkers=2` is not accepted by the current root script because it forwards the flag to Turbo, which reports `unexpected argument '--maxWorkers'`. Use package-specific Vitest commands for constrained-worker verification. CI uses `pnpm test` without E2E Playwright; its PostgreSQL service and migration step run in GitHub Actions. No production posting path, persistence migration, invoice/payment workflow, or population-v2 calculation outside the canonical flock population service is included.

## Final browser compatibility verification

Verification run: 2026-11-15. The three requested browser workflows used the
owned-server runner and a disposable PostgreSQL database. Results, exact
commands, natural process exits, full E2E limitation, and teardown root cause
are recorded in the “Playwright teardown investigation” section below.

The synthetic B=10 browser fixture inserts immutable test ledger rows directly
into the disposable database. It is test setup only. Source review found no
fulfilment posting controller or production depletion writer and no enabled
server-side depletion gate. M4 mortality percentage semantics remain unchanged.
External consumer verification remains NOT VERIFIED. No production deployment
evidence is claimed; the production compatibility manifest remains unsigned.

## Remaining limitations

- Sales depletion can only become nonzero after the separately gated M5 fulfilment posting work.
- The sale-versus-mortality PostgreSQL test simulates a locked test transaction that writes persistence fixtures; it does not exercise a production sales service, which is intentionally out of scope.
- Rollback after effective sale postings requires coordinated v2 compatibility; reverting binaries alone would misstate on-farm birds.

## External consumer compatibility gate

Audit date: 2026-11-15. This section distinguishes source-merge readiness from
reader deployment and from enabling depletion posting. Repository evidence does
not establish production deployment state or identify any external API clients.

### What the ADR gates

| Gate                                 | ADR requirement                                                                                                                                                                                                                                                                                                                                                                      | Does consumer sign-off have to precede this gate?                                                                                                                                                                                                                                          | Repository evidence / status                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge population-v2 code into `main` | Decision 4 defines the migration and the dependency graph at section “M5 delivery order and hard dependencies” (M5-POP step 5b, ADR lines 965-993) makes M5-POP a hard predecessor of M5-05. The ADR does not state that external consumer sign-off must occur before code merge.                                                                                                    | **No explicit pre-merge consumer sign-off gate in the ADR.** This does not authorize production deployment or depletion posting.                                                                                                                                                           | Source review and focused browser evidence are recorded below. Required CI result remains pending until the PR run completes.                |
| Deploy v2 readers                    | “Coordinated rollout and write barrier,” steps 1-4 (ADR lines 374-401), calls for the depletion ledger to remain empty and posting unavailable; deploy API, shared contracts and web readers together; drain old API/web/internal writers and in-flight transactions; verify repository and external consumers; then sign a deployment manifest while the write gate remains closed. | **Not explicitly required before the first reader deployment while B=0.** The safe sequence requires old writers drained and consumer acceptance verified before proceeding to depletion activation. The reader rollout is a coordinated maintenance cutover, not a mixed-version rollout. | No production manifest, consumer inventory or deployment evidence is present in this repository. **NOT VERIFIED.**                           |
| Enable sales depletion posting       | ADR rollout steps 4-5 (lines 397-407) require the gate to remain closed through compatibility checks and a signed manifest identifying compatible API/web/shared builds plus completed persistence, M5-LOCK and M5-POP prerequisites. Only M5-05 may enable posting; the central writer must enforce the server-side gate so internal callers cannot bypass it.                      | **Yes.** External consumers and deployment compatibility must be verified and signed off before the first depletion can be posted.                                                                                                                                                         | No production sign-off or deployed gate state is available here. M5-POP has no posting writer or gate to enable. **BLOCKED / NOT VERIFIED.** |

Decision 4 rollout steps 1-6 also specify the old-writer drain, stale-view refresh,
fail-closed behavior on missing v2 data, and rollback restriction: once B history
exists, mortality-only M4 readers/writers must not be restored (ADR lines 381-412).
The ADR calls population v2 a deployment/release contract, not a current API
version or feature flag (lines 333-342). Thus an HTTP client version check cannot
be claimed from this codebase.

### Repository consumer inventory

“Owner not recorded” means no owner/sign-off metadata was found in the inspected
repository. Compatibility status is based on source, not on production traffic.

| Consumer                                                                                                 | Owner, if known                             | Existing population assumption / use                                                                                                                       | V2 compatibility status                                                                                                                     | Required change / evidence                                                                                                                                                                                          | Sign-off status                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/app/app/flocks/page.tsx`                                                                       | Not recorded; web implementation            | Reads API `liveBirdCount` for the list and displays B separately. Does not calculate population.                                                           | V2 typed and labeled for remaining on-farm birds.                                                                                           | Keep using API values; run the real browser workflow against the deployed v2 response.                                                                                                                              | Repository source reviewed; production sign-off NOT VERIFIED.                          |
| Flock detail route and `apps/web/components/flocks/details.tsx`                                          | Not recorded; web implementation            | Displays live count, mortality and mortality percentage.                                                                                                   | V2 typed; labels remaining birds and net fulfilled sales separately.                                                                        | Verify detail page refreshes after mutations and on a deployment containing only compatible readers.                                                                                                                | Repository source reviewed; production sign-off NOT VERIFIED.                          |
| `apps/web/app/app/flocks/actions.ts` mortality/baseline server actions                                   | Not recorded; web implementation            | Submits death count or starting baseline; does not calculate available birds in the browser.                                                               | Uses current API mutation endpoints; the API owns the combined guard.                                                                       | Drain old server actions before depletion activation; verify no cached action/build remains.                                                                                                                        | Repository source reviewed; deployment drain NOT VERIFIED.                             |
| `apps/web/lib/management/flock-api.ts`                                                                   | Not recorded; web implementation            | Parses list/detail responses.                                                                                                                              | Strict v2 schemas require B and validate `live = S - M - B`; absent B is rejected, not defaulted.                                           | Ensure all shipped web builds use this parser.                                                                                                                                                                      | Repository source reviewed; deployed build NOT VERIFIED.                               |
| `FlocksController` list/detail and `FlocksService`                                                       | Not recorded; API implementation            | Existing flock URLs and `liveBirdCount` field were M4-shaped; server was the source of M4 live count.                                                      | Current source returns V2 response types and canonical S-M-B values on the same URLs. Field name is unchanged while meaning changes if B>0. | Deploy only with v2 web/shared consumers; identify external clients because the endpoint is not versioned.                                                                                                          | Repository source reviewed; deployed API versions NOT VERIFIED.                        |
| `packages/types/src/flock.ts` legacy `FlockMetrics` and response aliases                                 | Shared package owner not recorded           | Legacy M4 response shape uses `liveBirdCount = S-M`.                                                                                                       | **Legacy contract remains exported and is explicitly documented as M4.** Current API/web use explicit `FlockMetricsV2` types.               | External packages importing legacy aliases still require inventory before depletion activation. Do not treat successful shared-package compilation as consumer sign-off.                                            | No package consumer inventory/sign-off found; NOT VERIFIED.                            |
| `packages/types/src/sales-v2.ts` and `packages/validation/src/sales-v2.ts`                               | Shared package owner not recorded           | Staged contract is explicit V2.                                                                                                                            | V2 requires B and enforces the population equation.                                                                                         | Rebuild and deploy all consumers together; verify lockfile/package build used by each deployed application.                                                                                                         | Repository tests pass; deployed package versions NOT VERIFIED.                         |
| `apps/web/lib/management/flocks.ts` maturity helpers                                                     | Not recorded; web implementation            | Accepts legacy `FlockMetrics` type but only reads maturity fields; performs no live-population arithmetic.                                                 | Runtime behavior is V2-safe for the fields it consumes; its legacy type dependency is broader than needed.                                  | No calculation change required; consider narrowing the type when touching this helper.                                                                                                                              | Repository source reviewed; no external sign-off applicable.                           |
| M4 API/pure tests and M5-POP PostgreSQL tests                                                            | API maintainers not recorded                | M4 fixtures use B=0 and validate old values; new tests cover mixed M/B, depletion, reversal, scopes and lock serialization.                                | API/validation regression suites passed as recorded above.                                                                                  | Retain B=0 regression cases and run PostgreSQL concurrency suite for changes to writer locking.                                                                                                                     | Test evidence exists; it is not production consumer sign-off.                          |
| `apps/web/e2e/poultry.browser.ts`, `apps/web/e2e/management.spec.ts`                                     | Web test owner not recorded                 | Previously asserted the old detail text `Live population100` / `Live population98`.                                                                        | Updated to assert S, M, B and live count through the real API/UI path; covers no-sales B=0 plus synthetic B=10 with mortality and feed.     | Keep the synthetic ledger fixture isolated to disposable browser databases; it is not a posting implementation.                                                                                                     | Target workflows pass with clean teardown; full E2E has a separate 46/47 result below. |
| `docs/m4-workflow.md`, `docs/m5-lock-mutation-locking.md`, `apps/api/prisma/schema.prisma` flock comment | Documentation/schema owners not recorded    | M4 formula and schema comment previously read as current mortality-only semantics.                                                                         | Historical docs now identify the M4 formula as superseded; schema comment describes both ledgers.                                           | No database or production behavior change is implied by these documentation/comment updates.                                                                                                                        | Updated in this verification task.                                                     |
| Reporting and aggregate consumers in this repository                                                     | Not applicable / no separate consumer found | Repository search found no separate reporting/analytics calculation of live population beyond canonical `FlockMetricsService` and its list/detail callers. | No additional runtime consumer discovered.                                                                                                  | Re-run repository search when adding reporting, exports or another API.                                                                                                                                             | Repository-only search; external reporting NOT VERIFIED.                               |
| Deployment integrations (`.github/workflows/ci.yml`, package scripts)                                    | Not recorded                                | CI installs dependencies, migrates its test DB, tests and builds; it is not a production release workflow.                                                 | No population-v2 manifest, write-barrier setting, old-instance drain or external sign-off gate is implemented here.                         | Provide deployment-system evidence and a signed compatibility manifest; do not infer production controls from CI success or `nest deploy`.                                                                          | NOT VERIFIED.                                                                          |
| External API clients, scheduled jobs, exports, BI/reporting, cached/mobile clients                       | Unknown                                     | Could read `liveBirdCount`, calculate S-M themselves, or use mortality-only guards. No such deployed consumers are discoverable from repository contents.  | **NOT VERIFIED.** No client names, owners or compatibility claims are invented here.                                                        | Inventory from API gateway/observability, integrations registry and business owners; test each consumer's handling of B, live count and mortality separately; record owner and sign-off in the deployment manifest. | NOT VERIFIED; required before depletion activation.                                    |

### Coordinated rollout checklist

Do not mark a checklist item complete based solely on this source audit. Record
deployment evidence and responsible owner for each operational gate.

- [ ] **M5-03 persistence:** confirm the approved additive migration is deployed
      to the target environment; verify the depletion ledger exists and is empty;
      retain existing M3/M4 records. Production database evidence is NOT VERIFIED.
- [ ] **M5-LOCK writer compatibility:** deploy the approved canonical locks with
      M3/M4 writers; verify all mortality, baseline, feed and inventory writers use
      the intended build; drain old API workers, web server actions, jobs and
      in-flight old transactions. Production state is NOT VERIFIED.
- [ ] **M5-CAT dependency:** confirm catalog and poultry eligibility are deployed
      and authorized; retain the no-posting state. Catalog presence alone does not
      enable depletion. Production state is NOT VERIFIED.
- [ ] **M5-POP readers:** deploy API, shared types/validation and web as one
      compatible release while B=0; confirm list/detail responses require B, UI
      distinguishes sales from mortality, and no reader defaults absent B to zero.
      Browser verification is recorded below; production deployment remains unverified.
- [ ] **External consumers:** produce an owner-attributed inventory covering API
      clients, server actions, background jobs, reports, exports, caches and any
      mobile/BI integrations; obtain explicit acceptance of the changed
      `liveBirdCount` meaning. This evidence is NOT VERIFIED and is a hard gate before
      depletion activation.
- [ ] **Write barrier and old-writer drain:** keep all fulfilment POST/reversal
      entry points and internal writers unavailable or fail-closed using a
      server-side deployment gate. Drain old API/web/internal writers and active
      transactions. Record the gate state and compatible build IDs; do not accept a
      request/header/UI switch as the gate.
- [ ] **M5-05 readiness:** require M5-04 order readiness plus M5-03, M5-LOCK,
      M5-CAT and M5-POP completion. The central domain writer must enforce the gate
      for both controller and internal callers. No M5-05 writer exists in this task.
- [ ] **First permitted depletion:** while the gate is still closed, pass B=0 and
      synthetic-B compatibility, farm/organization authorization, PostgreSQL
      concurrency, idempotency, correction and rollback checks. Sign the deployment
      manifest naming API/web/shared versions, consumer owners/sign-offs, migration
      state, old-writer drain and gate approver. Then enable only through the
      explicit approved server-side deployment step. No production evidence is
      currently available; activation is BLOCKED.
- [ ] **Rollback:** if no effective B exists, restore the prior behavior only
      through a reviewed coordinated rollback. If any B exists, disable further
      posting first and keep V2-compatible reads and mutation guards; never deploy
      mortality-only code, zero the ledger or post compensating events merely to
      make rollback possible.

### Gate recommendations from repository evidence

- **Merge readiness: SAFE, subject to required CI.** The targeted poultry and
  management browser runs pass and terminate naturally as recorded below. The
  broader optional web E2E run has one separately reproduced shell interaction
  failure; `.github/workflows/ci.yml` does not include Playwright E2E. External
  consumer sign-off is not a pre-merge ADR gate; external consumers remain NOT
  VERIFIED and are a hard depletion-activation gate. No production compatibility
  claim can be made from this repository.
- **Depletion activation: BLOCKED.** External consumer owners/sign-offs,
  production migration and M5-LOCK deployment evidence, compatible API/web
  build IDs, the server-side M5-05 write gate, and the old-writer drain are all
  NOT VERIFIED here. Keep depletion posting disabled until each checklist item
  has evidence in the deployment manifest.

## Playwright teardown investigation (2026-11-15)

### Root cause and correction

The browser tests completed, but Playwright then hung at `Terminating the
WebServer`. The configured `webServer` entries launched API, auth proxy and
Next.js processes through shell children. The installed Playwright 1.64.1
Windows process manager does not support graceful `webServer` shutdown and
falls back to terminating the process tree. That bypassed application cleanup
and could leave the runner waiting after the last test. This was infrastructure
teardown, not population logic, test fixture teardown, or global teardown.

The E2E runner now owns API, auth proxy and Next.js as direct Node children,
assigns per-run ports and a disposable database, and sends each server an IPC
shutdown request in reverse startup order. API shutdown awaits Nest's
`app.close()` (including Prisma/module teardown); Next shutdown closes the HTTP
server and Next application; proxy shutdown closes its HTTP server. The runner
waits for each child's natural `close` event and disposes the temporary
database afterward. Browser specs use the runner-provided dynamic API/proxy
origins. The standard `test:e2e` script uses this runner. No `process.exit()`,
force-kill, or timeout increase was added; Playwright's configured 30,000 ms
per-test timeout is unchanged.

### Verification evidence

All commands were run from the repository root on
`m5-pop/sales-aware-flock-population`. Each browser command returned naturally;
the reported elapsed time is the runner's total `elapsedMs`, including server
startup and cleanup. For the three requested workflows, Playwright exited with
code 0, Next.js, auth proxy and API each acknowledged shutdown and closed with
`code=0, signal=null`, and the runner reported `ownedServersRemaining=0`.

| Workflow                 | Exact command                                                                                                                                | Results                   | Runner elapsed | Exit / termination                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------: | ------------------------------------ |
| Poultry independently    | `node apps/web/e2e/run-poultry.mjs playwright.poultry.config.ts`                                                                             | 3 passed                  |      46,521 ms | 0; natural; no owned children remain |
| Management independently | `node apps/web/e2e/run-poultry.mjs playwright.config.ts e2e/management.spec.ts`                                                              | 17 passed                 |     109,544 ms | 0; natural; no owned children remain |
| Both together            | `node apps/web/e2e/run-poultry.mjs playwright.population.config.ts`                                                                          | 20 passed                 |     127,212 ms | 0; natural; no owned children remain |
| Full web E2E package     | `pnpm --filter @ancastle/web test:e2e`                                                                                                       | 46 passed, 1 failed of 47 |     249,690 ms | 1; natural; no owned children remain |
| Isolated shell test      | `node apps/web/e2e/run-poultry.mjs playwright.config.ts e2e/shell.spec.ts -g "switches organizations without carrying stronger permissions"` | 0 passed, 1 failed        |      59,925 ms | 1; natural; no owned children remain |

The runner logged the child PIDs and a successful close event for every process
in each run. No process from these five runs remained. Two Node processes from
older pre-fix diagnostics were still present at final inspection, but neither
owned a listener on the old test ports. They were not children of these runs
and were not force-killed as part of this correction.

Affected regression tests passed:

- `pnpm --filter @ancastle/api test -- src/modules/poultry/flock-metrics.spec.ts`:
  1 file, 7 tests passed.
- `pnpm --filter @ancastle/web test -- lib/management/flock-actions.test.ts`:
  1 file, 11 tests passed.

Final quality gates passed: `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm build`, and `git diff --check`. The first format check
identified style in `apps/web/e2e/run-poultry.mjs`; Prettier was applied to that
file and the final format check passed.

As an additional check of the changed canonical package script,
`pnpm --filter @ancastle/web test:e2e` ran all 47 web browser tests. It reported
46 passed and one unrelated shell organization-switching test timed out while
clicking the user-menu summary. The exact isolated rerun,
`node apps/web/e2e/run-poultry.mjs playwright.config.ts e2e/shell.spec.ts -g
"switches organizations without carrying stronger permissions"`, reproduced
that test failure: the element was visible, but Playwright reported the page
root intercepting pointer events. Both runs still shut down all owned servers
naturally and logged `ownedServersRemaining=0`. No timeout was increased and no
unrelated shell UI change was made. This leaves a separate existing browser
workflow issue for follow-up; it does not affect the independently passing
poultry/management runs or the teardown fix.

### Remaining limitation and recommendation

These runs establish clean shutdown for the requested poultry and management
workflows using the owned-server runner. They do not establish production
deployment state or external consumer compatibility. The runner uses disposable
PostgreSQL and requires the repository's configured Redis service. No
fulfilment posting, server-side depletion gate, or population business logic
change was introduced. External consumer verification remains NOT VERIFIED;
the production compatibility manifest remains unsigned.

- **Merge readiness: SAFE**, with respect to the requested Playwright teardown
  issue and repository verification. The prior teardown-based conditional
  status is superseded by the three clean runs above. External consumer sign-off
  is not a pre-merge ADR gate.
- **Depletion activation: BLOCKED.** The deployment and external-consumer
  evidence described above remains outstanding; these local checks do not
  authorize deployment or activation.
