# M5-05 final pre-merge audit

Audit date: 2026-11-16. Branch: `m5-05/atomic-order-fulfilment`.
Recommendation: **CONDITIONAL**. All requested local verification passed; required
hosted CI/security checks must still pass on a future PR head. Production
activation remains **BLOCKED**. No commit, push, PR, merge or depletion activation
is performed by this audit.

The actual [M5-05 card](https://trello.com/c/UUnzAEFJ) was reread and is now
Review / Testing. The approved M5-01 ADR, M5-LOCK, M5-POP, M5-04 implementation,
workflow guide and previous verification report were inspected. Earlier counts
in [the implementation report](m5-05-verification.md) remain historical evidence;
this audit records new execution after the focused correction.

## Findings by severity

1. **High operational release limitation, outstanding:** production migration
   state, compatible deployed API/web/shared builds, old-writer drain and external
   consumer sign-offs are not verified. The runtime activation service checks
   only an exact server environment flag. It does not inspect a signed manifest,
   query production deployment state or prove old writers were drained. Those are
   mandatory operator checks in the ADR deployment sequence. A manually set
   `true` is not evidence that they passed. Keep the gate closed until the signed
   manifest and release evidence are reviewed. This is not a claim that a missing
   automated manifest parser is an implementation defect; the ADR defines an
   explicit operator sign-off/enablement step rather than such a parser.
2. **Medium API contract defect, corrected:** reversal checked for an original
   batch before examining an existing scoped idempotency receipt. Reusing a
   successful reversal key against a nonexistent target returned 404 instead of
   the ADR-required 409 payload conflict. A real HTTP regression reproduced
   `expected 409, got 404` before correction. Missing-target discovery now still
   acquires the scoped command/farm lock plan, reauthorizes and compares the
   receipt, then returns 404 only for a new key. No resource or prior intent is
   disclosed. Existing-target full transaction ordering is unchanged.
3. **Low verification gaps, closed:** added opposite-winner feed/fulfilment and
   stock/reversal tests, concurrent identical reversal keys, successful HTTP
   reversal replay and denied revoked-actor replay, exact fractional produce and
   commercial snapshot assertions, missing/malformed activation cases, and sealed
   rollback coverage for produce-only and poultry-only batches as well as mixed.

No remaining application defect was identified in the audited paths. This is
bounded source/test evidence, not a certification of production configuration or
unmanaged database writers.

## 1. Transaction atomicity

[`FulfilmentsService.post`](../apps/api/src/modules/fulfilments/fulfilments.service.ts)
owns one READ COMMITTED `$transaction`. All reads/checks and writes use its `tx`.

| Path          | Effects before one commit                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Produce only  | Fulfilment header; negative M3 ISSUE per allocation; linked FulfilmentLine; order version increment; successful FulfilmentCommand last        |
| Poultry only  | Header; allocation lines; matching FlockSaleDepletion per line; version increment; receipt last                                               |
| Mixed         | Both sets above within the same callback/transaction; no independently committing domain call                                                 |
| Full reversal | REVERSAL header; original-linked full lines; positive M3 ADJUSTMENTs and original-linked depletion reversals; version increment; receipt last |

The service calls only
[`InventoryStockService.postMovementInTransaction`](../apps/api/src/modules/inventory/inventory-stock.service.ts),
never its outer `postMovement` transaction wrapper. The helper uses the supplied
transaction for prepared-plan verification, ownership/unit checks, ledger SUM and
movement insertion. Its injected PrismaService cannot independently commit these
effects. Poultry ledgers, line creation, receipt creation and version update also
use the same transaction.

M5-03's deferred `fulfilments_complete_at_commit` validates a nonempty complete
batch, poultry ledgers, receipt and full reversal cardinality. Snapshot/history
and linkage triggers remain enabled. Receipt insertion seals the batch. There is
no savepoint recovery or swallowed domain exception.

The mixed-source exhaustion test fails after earlier successful writes and proves
no partial ledger/receipt survives. Parameterized pre-commit failure tests for
PRODUCE, POULTRY and MIXED pause after sealing the command, inject a failure, and
compare counts of headers, lines, movements, depletions and receipts. The unchanged
original intent/key/version then succeeds. Equivalent reversal failures restore
the pre-reversal ledger state and permit the unchanged key/version retry. These
prove receipt and order-version rollback as well as physical rollback.

## 2. Locks and concurrency

[`lockMutation`](../apps/api/src/database/mutation-locks.ts) acquires organization
FOR KEY SHARE, command advisory identity, Order FOR UPDATE, fixed-table sorted
definition SHARE locks, sorted flock advisory/row UPDATE locks, then sorted M3
stock advisory positions. UUIDs are canonicalized. Code generation is UUID-based
and never upgrades the organization parent to a sequential-code lock.

Post discovery is scoped but not authoritative until locks and revalidation.
Correction discovers immutable sealed history; its plan includes the original
farm/item/flock identities, without requiring mutable product eligibility.
Missing-target key comparison uses only the applicable parent/command/farm prefix
and has no physical effects. Helpers can reuse only subsets of the prepared plan.

| Interacting writer   | Shared serialization and audited outcome                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M3 ISSUE/ADJUSTMENT  | Same parent/item definitions and stock advisory namespace; movement-derived stock checked after wait                              |
| M4 mortality         | Same flock advisory key and row lock; effective S-M-B guards observe the winner's committed depletion/mortality                   |
| M4 feed post/reverse | Definitions before flock before stock, including implicit flock FK protection; no population side effect                          |
| M5-04 cancellation   | Same scoped order UPDATE lock; stale loser gets version conflict; refreshed cancelled state still forbids posting                 |
| Concurrent postings  | Same command/order/source lock stages; source competition across different orders cannot oversell                                 |
| Concurrent reversals | Order/source serialization plus unique original reversal links; same key replays, distinct key produces no duplicate compensation |

The original ten selected concurrency tests are deterministic. `holdCommit`
wraps a real domain transaction, pauses after its effects but before commit,
obtains its backend PID, and `blockedBy` queries `pg_blocking_pids` until the
competitor is observed waiting. Only then is the holder released. There is no
scheduling sleep and no replacement of database results. Post-commit assertions
check both winner/loser results and ledgers. The original selection omitted the
feed test because its title did not match that selection pattern; it passed in
the full suite. The audit's corrected selection includes it and the new cases.

This evidence covers actual lock waits; it is not a stress/throughput benchmark
or proof of every possible schedule. No test timeout was increased.

## 3. Idempotency

Both services validate UUID keys through shared Zod validation. Hash version 1
uses SHA-256 over stable field order, target/operation/version, UTC occurrence,
trimmed optional text, and sorted lowercase UUID/exact decimal allocations, or
reversal reason/attestation. Actor and organization/farm/operation scope are bound
separately in the immutable receipt. Database uniqueness and the command advisory
lock serialize concurrent identical or conflicting submissions.

Fresh user/membership/organization/farm permission checks precede replay and run
again after lock waits. Matching replay returns original status, event and version
before mutable state/availability/eligibility checks. Actor/hash mismatch returns
safe conflict without prior payload. Farm history/resource queries remain scoped.
Successful original-actor HTTP reversal replay is byte-for-byte equivalent at the
JSON object level; revoked membership is denied by both HTTP and the domain entry
point. Failed commands leave no permanent PROCESSING/key record. The corrected
missing-target conflict behavior is covered without weakening authorization.

## 4. Quantities and commercial snapshots

Shared strict schemas reject excessive produce precision and nonpositive values;
poultry requires whole Int32-bounded birds. Produce EACH is rechecked against the
locked server unit. Demand is aggregated per order line across all allocations
and farms, using original-minus-reversal history. Flock consumption is aggregated
across lines before comparing to the single-statement M5-POP M/B authority under
the flock lock. M3 checks every negative produce effect under the shared stock
lock, so a late source failure rolls back the batch.

The writer updates only Order.version (and Prisma's updatedAt), never prices,
ordered quantities, customer/catalog snapshots, currency or commercial terms.
The new fractional test verifies exact 1.125 consumption/compensation, 8.875
remaining stock/demand and unchanged commercial records/totals after catalog
rename and reversal. Database snapshot triggers remain active. No payment,
invoice, receivable or monetary balance is created or mutated.

## 5. Cancellation and correction

Partial cancellation preserves committed allocations and closes only remaining
demand. Both deterministic order-lock winner schedules are covered. A fully
fulfilled order is not cancellable under M5-04. Cancellation never posts a
reversal or deletes history. Successful receipts replay independently of the new
commercial state, subject to current access and the deployment gate.

Correction derives every source/unit/quantity from the original immutable batch;
full linkage/quantity and unique reversal constraints apply. Inactive source
definitions and closed flocks do not block correction, but active authorized farm
access remains required. Cancellation can be followed by an attested posting-error
correction without reopening demand. Reversal of a reversal and double reversal
are rejected; concurrent identical reversal keys return one compensation. The
required true attestation and nonempty reason do not implement customer returns.

## 6. Authorization and redaction

Controller guards authenticate, resolve a current organization-specific role and
verify farm access. The domain service independently rechecks those facts in the
transaction, using centralized permission mappings and FarmAccessService. No body
ID or universal user.role grants authority. Customer/order/product/item queries
retain organization scope; operational queries also retain farm scope.

STAFF can see whole-order commercial progress. Organization order DTOs keep
`sourceDetails=REDACTED`; commercial audit projections omit operational sources.
Farm event DTOs explicitly allowlist fields and counts/pages are restricted to the
authorized farm under one read snapshot. Restricted farm/source IDs, nested Prisma
relations, key hashes and prior conflicting payloads are not serialized into
responses or unavailable-source messages. Cross-tenant selectors, unassigned farms,
inactive states, spoofed payload IDs and revoked replay access have coverage.

## 7. Activation safety

[`FulfilmentActivationService`](../apps/api/src/modules/fulfilments/fulfilment-activation.service.ts)
allows only `process.env.SALES_FULFILMENT_ENABLED === 'true'`. Environment schema
default is false for production as well as other modes. Malformed supplied values
fail startup validation; missing/false/malformed runtime values fail the service
gate. Tests now cover missing, false, uppercase TRUE and 1. The controller and both
central domain entries enforce it, with another check after waiting for locks.
Both posting and correction close together under the approved rollback policy;
history reads remain available.

Repository search found the only production fulfilment/depletion inserts in the
gated service. Synthetic direct inserts in tests do not enable a production path.
Database/raw-SQL access is not constrained by this environment flag and requires
the documented compatible-writer deployment barrier.

**Activation prerequisites are documented operator checks, not automatically
checked runtime assertions.** The [deployment checklist](m5-05-atomic-order-fulfilment.md#deployment-activation-checklist)
requires applied M5-03 schema, completed/drained M5-LOCK, compatible M5-POP API/web/
shared builds, CAT/order readiness, external consumer inventory/sign-offs and a
verified signed manifest before explicitly enabling the server flag. None of that
production evidence was supplied or inferred from local tests. No gate/configuration
was enabled in production. Do not roll back to mortality-only code once B history
exists or falsify ledger reversals to permit a software rollback.

## 8. New verification evidence

All durations below are wall-clock process durations unless a Vitest duration is
identified explicitly. Local ignored harnesses contain no credentials and do not
change committed test configuration. The regression harness creates a uniquely
named disposable database, applies the committed migration chain, passes that
DATABASE_URL to the sequential workspace tests, and drops only its owned database.
Newer integration suites also create/dispose their own databases. The configured
development database is not reset or migrated.

| Check / exact command                                                                                                                                        | Count                                                                                   | Duration                                       | Exit |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------- | ---- |
| Pre-fix `pnpm --filter @ancastle/api test -- --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts -t 'reversal-key conflict'` (PowerShell) | 1 expected failure, 47 filtered out                                                     | 14.24s Vitest                                  | 1    |
| `pnpm --filter @ancastle/api test --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts` (cmd.exe)                                          | 48 passed                                                                               | 54.19s (50.89s Vitest)                         | 0    |
| Corrected independent concurrency command below                                                                                                              | 15 selected passed (14 barrier cases and 1 replay/conflict regression), 33 filtered out | 25.70s (24.07s Vitest)                         | 0    |
| Forced uncached sequential workspace regression below                                                                                                        | API 515 / 43 files; validation 178 / 8 files; web 116 / 13 files; 809 total             | 295.66s including disposable DB setup/disposal | 0    |
| `pnpm format:check`                                                                                                                                          | All matched files passed                                                                | 20.58s                                         | 0    |
| `pnpm lint`                                                                                                                                                  | 2 tasks passed uncached; API 0 warnings/errors                                          | 83.98s                                         | 0    |
| `pnpm typecheck`                                                                                                                                             | 4 tasks passed uncached                                                                 | 35.15s                                         | 0    |
| `pnpm build` (sandboxed, initial attempt)                                                                                                                    | Failed to fetch existing Geist/Geist Mono Google Fonts                                  | 30.59s                                         | 1    |
| `pnpm build` (network-enabled retry)                                                                                                                         | 4 tasks passed uncached; no font/dependency edits                                       | 157.39s                                        | 0    |
| `git diff --check`                                                                                                                                           | Passed                                                                                  | 0.31s                                          | 0    |

Concurrency runs from `apps/api`, using a direct argv vector to preserve the regex:

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts -t "serializes|versus|conflicts|feed"
```

Root regression command (TURBO_FORCE=true):

```text
node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-05-verify.mts root
```

This invokes `pnpm test --concurrency=1 -- --maxWorkers=2`, emitting
`turbo run test --concurrency=1 -- --maxWorkers=2`. Package suites run sequentially
with genuine concurrent transactions inside the tests. Shared builds and test
tasks are forced uncached for this audit.

An initial audit-runner argument separator forwarded through cmd.exe differently
from PowerShell and started a broader selection; it was interrupted and is not
counted as evidence. A subsequent shell-quoted concurrency regex also selected
the wrong tests (6 passed, 482 filtered out, 99.10s, exit 0); that is explicitly
not accepted as concurrency verification. The corrected direct-argv invocation
above avoids shell argument rewriting. No failed/incorrect selection was hidden
by changing test timeouts or assertions.

The final sequential regression passed 809 tests (API 515, validation 178, web
116), with all five Turbo tasks uncached. Vitest durations were API 230.16s,
validation 5.02s and web 35.39s. The 48-test fulfilment suite passed within that
API run in 34.77s. M5-03's complete 16-test persistence/migration suite passed in
29.81s; no migration was created or edited. Existing Turbo warnings about missing
test output artifacts do not change the exit-0 result.

The independent selection passed 15 tests in 24.07s Vitest / 25.70s process time:
14 barrier-based concurrency cases and one canonical replay/conflict regression;
33 tests were intentionally filtered out. The full 48-test focused run passed
independently as well. No timeout or worker configuration in source was changed.

The initial uncached build failed solely at Next.js's existing Google Fonts fetch.
The network-enabled retry passed all four build tasks uncached, without changing
fonts, dependencies or source to hide the failure. All quality-gate commands in
the table eventually exited 0 after that environment-only retry.

Repository PostgreSQL and Redis containers were started for the audit and stopped
after all database checks to restore their initial state. Other containers were
untouched. Production gate configuration was not changed.

## Required follow-up

- Require successful hosted CI/security checks on the eventual PR head before
  merge; local results do not satisfy branch protection.
- Keep production posting/correction disabled until the release owner verifies
  the manifest, all prerequisites, external consumer sign-offs and old-writer
  drain. Local source merge readiness is separate from production activation.
- Retain immutable history and population-v2 compatibility during deployment,
  correction and rollback. Truthful posting-error attestation remains an operator
  responsibility; actual customer returns belong to later work.

No broad refactoring, migration/dependency update, new sales UI or financial
workflow was introduced. Audit changes are limited to reversal receipt ordering,
focused tests and documentation. Work remains uncommitted.
