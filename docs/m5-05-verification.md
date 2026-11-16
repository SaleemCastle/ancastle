# M5-05 verification report

Branch: `m5-05/atomic-order-fulfilment`. Date: 2026-11-16.
Status: local implementation and full regression passed; uncommitted. No push, PR, hosted CI, merge,
production deployment or depletion activation is performed.

This implementation report records the initial 799-test verification. See the
[final pre-merge audit](m5-05-final-audit.md) for the later receipt-ordering fix,
additional tests and new execution evidence. Trello is now Review / Testing;
the earlier In Progress status below describes the implementation run.

## Scope and review

New fulfilment module composes the existing M3 transactional ledger, canonical
mutation locks, M5-POP population authority and M1 authorization policy. Shared
M5-02 schemas and M5-03 models/migration are reused. Existing authentication,
inventory/mortality/feed semantics and order creation retry behavior are preserved.
The new centralized permissions implement the ADR matrix. No schema, migration,
dependency version, sales UI or financial model changes are needed.

Implementation and deployment details are in
[the workflow guide](m5-05-atomic-order-fulfilment.md).

## Executed verification

| Check                                                                            | Result                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Focused PostgreSQL suite, initial implementation                                 | 26 tests passed                                                                           |
| Focused suite after additional eligibility/unit tests                            | 36 tests passed                                                                           |
| Final fulfilment suite including pre-commit failure and conflicting-key coverage | 38 tests passed within full API regression                                                |
| Sequential workspace regression                                                  | Passed: API 505 / 43 files, validation 178 / 8 files, web 116 / 13 files; 799 tests total |
| Independent focused concurrency run                                              | Passed: 10 selected tests; 28 intentionally filtered out                                  |
| `pnpm format:check`                                                              | Passed                                                                                    |
| `pnpm lint`                                                                      | Passed, API 0 warnings/errors                                                             |
| `pnpm typecheck`                                                                 | Passed all four packages                                                                  |
| `pnpm build`                                                                     | Passed all four packages; unchanged web/shared build tasks reused Turbo cache             |
| `git diff --check`                                                               | Passed                                                                                    |

Focused command:

```text
pnpm --filter @ancastle/api test -- --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts
```

The repository PostgreSQL/Redis containers were initially stopped. Initial
focused attempts failed before any tests ran with a refused localhost:5432
connection. Starting the repository's existing services with
`docker compose up -d postgres redis` restored the test prerequisite. The focused
suite creates its own uniquely named disposable PostgreSQL database, applies all
committed migrations and disposes only that database.
The repository PostgreSQL/Redis containers were stopped again after verification
to restore their initial state; the unrelated running container was untouched.

The root regression also uses an ignored local harness that creates a separate
disposable database with all committed migrations, passes its DATABASE_URL to
the test process, then disconnects and drops only that owned database. This
avoids migrating/resetting the configured development database; older suites use
their configured database while newer suites create their own nested disposable
databases. The harness contains no credentials and is not a production entry point.

```text
node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/node_modules/.cache/m5-05-verify.mts root
```

It invokes `pnpm test --concurrency=1 -- --maxWorkers=2`, which emits
`turbo run test --concurrency=1 -- --maxWorkers=2` and package
`vitest run --maxWorkers=2`. Package suites are sequential; transactions inside
the concurrency tests still genuinely overlap. No source test timeout or worker
configuration is changed. A preliminary invocation with an extra separator
incorrectly forwarded `--concurrency` to Vitest; it failed CLI parsing and provides
no application verification evidence. The harness command was corrected.

The successful root invocation took 5m1s and exited 0. All five Turbo tasks
succeeded; API/validation/web test tasks were uncached. API tests took 250.36s,
including the complete M5-03 fresh/upgrade migration suite (16 passing tests).
The new fulfilment suite took 39.74s within that run. Shared validation's 178
count includes the repository's existing source/dist discovery. Turbo's existing
test-task configuration warns that no output files are produced; tests still
passed and the process exited normally. No test timeout was increased.

Independent PostgreSQL concurrency command:

```text
pnpm --filter @ancastle/api test -- --maxWorkers=2 src/modules/fulfilments/fulfilments.integration.spec.ts -t 'serializes|versus|conflicts a concurrent|competing'
```

This independent run exited 0: 10 selected tests passed, 28 were intentionally
filtered out, total duration 32.48s. The complete 38-test suite, including feed
serialization and all non-concurrency assertions, passed in the full regression.

Manual diff review checked canonical lock order and scoped discovery/revalidation,
one-transaction M3 composition, order balance/flock aggregation, immutable receipt
sealing, same-key actor/hash comparison and replay ordering, correction/cancellation
separation, DTO allowlists, and the disabled-by-default service/controller gate.
No unrelated source files, dependency versions, migrations, UI or financial
flows changed. Existing tests were retained without timeout/configuration changes.

Postman CLI status reports no initialized resources/account and an EACCES while
checking its skill repository. No Postman workspace setup/publication is needed
for this ticket: the existing Zod contracts and Supertest/PostgreSQL tests are
the reviewed local API contracts and executable verification.

## Remaining risks and release status

- Production compatibility manifest, deployed build IDs, old-writer drain and
  external consumer inventory/sign-off remain NOT VERIFIED. The gate stays off
  by default; code completion cannot authorize deployment activation.
- Required hosted CI/security checks have not run because this task stops before
  commit or push. Trello remains In Progress, with no Done claim.
- Full-batch correction requires a truthful no-handover attestation. Physical
  customer returns and financial corrections remain out of scope.
- Application locks require compatible participating writers; raw SQL and legacy
  writers are controlled by the deployment write barrier, not by the gate alone.
