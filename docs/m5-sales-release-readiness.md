# M5 sales release readiness

Assessment date: 2026-11-20<br>
Task: M5-11 | Branch: `m5-11/sales-workflow-validation`<br>
Target: `main`<br>
Recommendation: **CONDITIONAL for development/PR review; production activation
NOT READY.**

M5-11 adds evidence-based workflow and release-readiness documentation. It does
not add features, schema changes, migrations, or an activation switch. The
production sales depletion gate was not enabled. Local E2E tests explicitly
enabled it only in an owned server process connected to a disposable database.

## Readiness by environment

| Readiness area                         | Assessment              | Evidence / remaining condition                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Development completeness**        | **PASS**                | Implemented M5 order, catalog, fulfilment, reversal and customer quantity history documented; focused PostgreSQL tests, full sequential workspace tests, real-API browser flows and local quality gates passed.                                   |
| **B. Staging verification**            | **NOT VERIFIED**        | No staging URL/build IDs, migration execution record, staged authorization walkthrough, write-barrier record, or staging rollback drill was supplied or exercised. Schedule this work before production activation.                               |
| **C. Production activation readiness** | **NOT READY / BLOCKED** | No verified production manifest, deployed compatible build inventory, external writer sign-offs, old-writer drain, write barrier, backup/restore evidence, activation approver, or post-activation observations. Keep the production gate closed. |

The overall recommendation is **CONDITIONAL**, because development validation is
complete while staging/production operational prerequisites remain unproven.
This is not approval to activate production depletion.

## M5-05 compatibility manifest

M5-05 specifies an operator-reviewed signed manifest; the runtime only checks
whether `SALES_FULFILMENT_ENABLED` equals the exact string `true`. It does not
read a manifest, inspect deployed versions, prove writer drain, or verify
backups. A true environment value alone is not a readiness check.

Before any activation, create and review the M5-05 manifest for the target
environment. It must identify at minimum:

- Environment, organization/farm scope, rollout window and accountable release
  owner/activation approver.
- Applied migration state and schema compatibility evidence.
- Deployed API, web/server-action and shared contract build IDs, each compatible
  with M5-LOCK and M5-POP.
- M5-LOCK completion and verified canonical mutation-lock protocol across all
  participating writers.
- M5-POP v2 live population contract compatibility, API/web readers and writers,
  \(B=0\) compatibility result, and the approved synthetic-depletion acceptance
  result.
- External writer inventory, each owner, compatibility disposition and explicit
  sign-off; evidence that incompatible writers are stopped.
- Write-pause/write-barrier start, old API/web/background/internal writer drain,
  in-flight transaction drain, and resume approval.
- Backup identifier/time, tested restore point/procedure, recovery owner and
  recovery verification.
- Feature-gate approver, planned activation time, pre/post checks, stop triggers,
  incident contact, and rollback-compatible build identifiers.

No signed M5-05 manifest or target-environment build identifiers were observed
for this assessment. **Manifest status: NOT VERIFIED.**

## Production activation checklist

All unchecked items block activation. Attach evidence to the release record;
do not treat this document's local tests as a substitute.

### Pre-cutover compatibility and protection

- [ ] Confirm approved M5-05 manifest for the exact target environment and
      deployment window.
- [ ] Inventory every application, job, script, integration and direct database
      writer that can alter inventory definitions/movements, flock baselines,
      mortality/feed, poultry depletion, farm grants or sales fulfilment.
- [ ] Obtain named owner sign-off and compatibility proof for each writer.
- [ ] Verify all production API, web/server-action and shared validation builds
      understand M5-LOCK and M5-POP v2.
- [ ] Verify database backup is recent and complete; restore it into an isolated
      environment and demonstrate recovery procedure and owner handoff.
- [ ] Confirm migration plan and schema state using the approved production
      migration process; do not use development migration commands against
      production.
- [ ] Define operator stop authority, incident contact, customer-impact
      communication path and approved rollback-compatible builds.

### Coordinated write barrier and cutover

- [ ] Pause writes that can affect covered inventory/flock/sales sources.
- [ ] Drain old API instances, old web/server actions, background/internal
      callers and all in-flight old transactions.
- [ ] Verify incompatible external writers are stopped or upgraded.
- [ ] Apply the approved migration/contract rollout in the sequence recorded by
      the ADR and M5-05 manifest.
- [ ] Verify schema and application health while the write barrier remains in
      force.
- [ ] Run the approved reconciliation/read-only checks; verify no duplicate,
      missing, or inconsistent stock movement, flock depletion, command receipt,
      or reversal linkage.
- [ ] Record operator names, timestamps and evidence; get release owner approval
      before resuming compatible writers.

### Feature-gate activation

- [ ] Confirm all pre-cutover items are signed and evidence is attached.
- [ ] Confirm target deployment explicitly sets the server-only gate; no
      request-supplied capability or UI switch can enable posting.
- [ ] Activate only the approved environment/organization scope and rollout
      cohort; keep unrelated environments unchanged.
- [ ] Verify an authorized low-risk produce posting and poultry posting through
      the approved staged/production procedure, then verify corresponding physical
      ledgers and immutable history.
- [ ] Verify an unauthorized farm request remains rejected, a replay does not
      duplicate effects, and reversal follows the approved exception policy.
- [ ] Monitor API errors, idempotency conflicts, inventory positions, flock
      population, order/fulfilment versions, and source authorization.
- [ ] Record evidence, approver, start time, end time, sample command IDs and
      resulting ledger references.

### Stop conditions

Do **not** activate, or immediately disable new posting and follow incident
procedure, if any of these conditions occurs:

- Missing/unverifiable signed manifest, migration evidence, build ID, writer
  inventory/sign-off, backup restore proof, old-writer drain, or write barrier.
- Any old/incompatible writer remains active or a participating writer bypasses
  the required mutation-lock protocol.
- API/web/shared contract version mismatch, population-contract mismatch, or
  failure of the required \(B=0\)/synthetic-depletion acceptance.
- Stock, flock population, movement, depletion, fulfilment, reversal, or
  idempotency evidence does not reconcile.
- Cross-organization or unassigned-farm access succeeds, sensitive source data
  leaks, or authorization is stale after a grant change.
- Posting can create partial effects, duplicate depletion, or an unexplained
  command receipt; rollback/error behavior differs from the signed procedure.
- Health/error monitoring, incident responder, release owner, or recovery
  operator is unavailable during rollout.

## Incident response and rollback

1. Stop new sales posting and reversal by disabling the server gate, then pause
   and drain all writers using the write-barrier procedure.
2. Preserve logs, command IDs, immutable fulfilment/reversal history, movement
   IDs, flock depletion IDs, deployment IDs and database backup references.
   Do not delete history, rewrite stock/population, or fabricate reversals.
3. Determine whether a command committed: use the same authorized scope and
   idempotency key/payload to query/replay according to the recovery runbook;
   reconcile the committed receipt with physical ledgers.
4. Prefer forward repair after compatibility analysis. A software rollback must
   not remove M5-POP awareness from any writer after depletion has been recorded.
   Do not roll back migrations or falsify depletion data just to restore an old
   writer.
5. Reopen writes only after the manifest, compatible writers, write barrier,
   reconciliation, and activation approval are repeated and recorded.

These are operational requirements from the approved ADR/M5-05. No production
incident or rollback drill was performed as part of M5-11.

## Validation evidence and commands

All local database/browser evidence was produced using disposable PostgreSQL
databases and Redis logical DB 15. The browser runner used unique test session
prefixes and owned API/auth-proxy/Next processes; it reported
`ownedServersRemaining=0`.

| Check                                                                      | Exact result                                                                                           | Exit |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---: |
| Focused sales/fulfilment/catalog/persistence/M3/M4 PostgreSQL integrations | 7 files; 107 tests passed                                                                              |    0 |
| Existing real-API sales browser workflows                                  | 2 passed; desktop and 390x844 mobile behavior                                                          |    0 |
| Sequential workspace tests                                                 | API 522/43 files; validation 180/8 files; web 138/17 files; 840 total                                  |    0 |
| `pnpm format:check`                                                        | All matched files formatted                                                                            |    0 |
| `pnpm lint`                                                                | API 0 warnings/errors; 2 tasks passed                                                                  |    0 |
| `pnpm typecheck`                                                           | 4 workspace tasks passed                                                                               |    0 |
| `pnpm build`                                                               | 4 workspace tasks reported successful; Turbo cache hits; Next production route build output successful |    0 |
| `git diff --check`                                                         | Passed for both final documentation files                                                              |    0 |

Local test evidence directly covers authorized poultry and produce workflows,
CASH/CREDIT intent and JMD snapshots, partial quantities, exact Decimal produce,
whole-EACH poultry, M3 ISSUE / full reversal ADJUSTMENT, poultry sale-depletion
and reversal, immutable history, net customer purchase quantities,
cross-organization/farm authorization, insufficient availability, concurrency,
stale farm access, same-key replay, unknown post-commit response, and
transaction rollback. See [the detailed workflow validation matrix](m5-11-sales-workflow-validation.md).

The workspace test output included a deliberately thrown redaction sentinel
(`Database password leaked here`) from the HTTP-exception filter test; that test
passed after verifying the API response does not expose it. This is expected test
logging, not evidence of a leaked runtime credential.

## Severity findings

- **High - production release blocker:** environment-specific manifest,
  production/staging migration and build state, external writer inventory and
  sign-offs, old-writer drain/write barrier, backup/restore evidence, and
  activation approvals have no direct evidence here.
- **Medium - deployment protocol dependency:** the server gate is a simple
  exact-value check. Operational correctness depends on the release process
  verifying all M5-05 prerequisites before setting it.
- **Medium - unmanaged writer risk:** raw SQL/legacy writers outside the common
  lock protocol are not serialized by application locks; identify, stop or
  upgrade them and enforce the barrier.
- **Low - hosted checks outstanding:** check the current PR's GitHub Actions
  quality result and applicable security/branch-protection requirements before
  merge; they are independent of the local evidence recorded here.
- **No open local functional finding:** the required local tests and quality
  gates passed for the code under review; this assessment does not certify
  hosted or deployed environments.

## M6 handoff boundaries

M6 must separately design and implement invoice issuance, payment collection,
accounts receivable, credit balances, payment allocation/reconciliation,
customer returns/credit notes, and delivery logistics. It must define how
commercial unit-price snapshots and partial fulfilment are converted into
invoice/payment ledgers. M5 order terms and net physical purchase history are
not substitutes for those ledgers. M5-11 does not start M6 work.

## PR readiness

**Recommendation: CONDITIONAL for PR review; not ready to merge until review and
hosted CI/security checks pass. Production depletion activation remains NOT
READY.** The documentation is committed and this PR is open for review. It is
not merged, and Trello remains in its existing In Progress state.

## References

- [M5-01 sales/fulfilment ADR and deployment rollout addenda](m5-01-sales-fulfilment-architecture.md)
- [M5-05 atomic fulfilment gate, manifest and rollback](m5-05-atomic-order-fulfilment.md)
- [M5-05 final audit](m5-05-final-audit.md)
- [M5-10 integrity audit](m5-10-sales-integrity-audit.md)
- [M5-08 order management UI](m5-08-sales-order-management-ui.md)
- [M5-09 fulfilment and customer history UI](m5-09-fulfilment-sales-history-ui.md)
- [M1 authorization workflow](m1-workflow.md), [M3 inventory foundation](../README.md#m3-inventory-foundation), [M4 poultry workflow](m4-workflow.md)
- [M5-11 Trello acceptance criteria](https://trello.com/c/4Iu26icT/75-m5-11-document-and-validate-sales-and-fulfilment-workflow)
