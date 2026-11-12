# M4 poultry milestone validation

Task: [M4-12](https://trello.com/c/AqFwqj4Y). Branch:
`m4-12/poultry-workflow-validation`. Execution date: 2026-11-12 UTC
(2026-11-11 local). Node.js 24.22.1, pnpm 12.15.0, Windows PowerShell.

Architecture and normal setup are documented in the [M4 workflow](../m4-workflow.md).
The [M4-11 audit](m4-11-poultry-coverage.md) supplies exact existing test references
for the 13 tenant/farm/ledger criteria. No product code, schema, test, dependency,
runner or fixture implementation is changed by M4-12.

## Evidence and execution status

**Direct** means executed for M4-12. **Inherited** means a prior execution record
only, not proof of a fresh run. Browser assertions are automated Chromium
interactions, not manual UI inspection. The root `pnpm test` gate runs Vitest,
not Playwright. Cached gates are identified separately from freshly executed tests.

| Scenario                                                                                       | Existing test or command                                                                                                                                                                                                             | Result / provenance                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A. Prisma client setup                                                                         | `pnpm --filter @ancastle/api db:generate`                                                                                                                                                                                            | PASS, direct; Prisma 7.10.1                                                                          |
| A. Empty database migration chain                                                              | Focused poultry suites using `temporaryDatabase()`                                                                                                                                                                                   | PASS, direct; committed SQL migrations replayed in new owned databases                               |
| A. Deployment-style migration and seed path                                                    | Disposable wrapper below: deploy into a fresh schema, seed only its owned database, verify no login is seeded                                                                                                                        | PASS, direct; 12 migrations, repeat deploy clean, seed verified                                      |
| B. Password authentication, assigned farm and verified context                                 | M4-08 management and M4-09 operational browser scenarios; M1 context tests in root suite                                                                                                                                             | PASS, direct                                                                                         |
| C. Create, edit, close, reactivate, retained history                                           | `flocks.integration.spec.ts`: `supports assigned manager create/list/detail/update and idempotent lifecycle without deleting history`; M4-08 browser scenario                                                                        | PASS API and browser, direct                                                                         |
| D. Mortality, live count and history                                                           | `flocks.integration.spec.ts`: `posts mortality/feed as STAFF, preserves audit fields and exposes current ledger metrics independently of age date`; M4-09 browser scenario                                                           | PASS API and browser, direct                                                                         |
| D. Over-mortality and baseline race                                                            | `flock-metrics.integration.spec.ts`: exact exhaustion and concurrent posts; `flocks.integration.spec.ts`: `serializes a starting-population edit against mortality posting`                                                          | PASS, direct                                                                                         |
| D. Internal mortality reversal and immutable history                                           | `mortality-event.persistence.spec.ts`; `flocks.integration.spec.ts`: `keeps scoped originals and reversals visible in paginated poultry histories`                                                                                   | PASS, direct; no public reversal route used                                                          |
| E. One atomic negative ISSUE and farm stock deduction                                          | `feed-usage.integration.spec.ts`: `records positive consumption and exactly one matching negative movement with precise derived stock`; M4-09 browser scenario                                                                       | PASS API and browser, direct                                                                         |
| E. Insufficient stock and complete rollback                                                    | `feed-usage.integration.spec.ts`: `retains the M3 negative-stock policy and advisory lock across concurrent feed posts`, `rolls back the complete operation on either inventory or feed persistence failure`; M4-09 browser scenario | PASS API and browser, direct                                                                         |
| E. Internal feed reversal and retained histories                                               | `feed-usage.integration.spec.ts`: `fully compensates once through append-only usage and inventory history`; scoped paginated reversal test                                                                                           | PASS, direct; positive ADJUSTMENT verified                                                           |
| F. Age, expected maturity, population, mortality percentage and feed by item/unit              | Existing six `flock-metrics.spec.ts` tests; `flock-metrics.integration.spec.ts`: `derives corrected mortality, live population and item-specific feed from history in a scoped snapshot`                                             | PASS, direct                                                                                         |
| F. Lifecycle independent of maturity; correct filter counts/pages                              | API maturity filter test; `poultry.browser.ts`: `keeps lifecycle and expected maturity independent with paginated maturity filters`                                                                                                  | PASS API and browser, direct                                                                         |
| G. Populated permitted farms and neighbouring flocks remain independent                        | `flocks.integration.spec.ts`: `keeps populated flocks, histories and feed stock independent across two assigned farms`                                                                                                               | PASS, direct; same assigned STAFF identity, distinct histories/metrics and shared-item farm balances |
| G. Foreign organization/flock, unassigned/foreign farm, spoofed scope and mutation permissions | `flocks.integration.spec.ts`: foreign-ID, separate farm-assignment, malformed-contract and inactive-state tests; M1 authorization/farm suites in root run                                                                            | PASS poultry and M1 APIs, direct                                                                     |
| G. UI permission denial and farm switching                                                     | M4-08 management and M4-09 operational browser scenarios                                                                                                                                                                             | PASS, direct                                                                                         |
| H. Mobile/desktop flock list/detail/forms/history                                              | Existing M4-08/09/10 browser scenarios at 375px and 1440px; assertions that document width does not exceed viewport                                                                                                                  | PASS, direct                                                                                         |

File locations: [poultry API suites](../../apps/api/src/modules/poultry/),
[persistence suites](../../apps/api/src/database/),
[management browser](../../apps/web/e2e/management.spec.ts),
[operational/indicator browser](../../apps/web/e2e/poultry.browser.ts).

## Reproducible commands and disposable setup

Prerequisites: dependencies installed from the pinned lockfile, local PostgreSQL
and Redis reachable through `.env`, and a PostgreSQL principal allowed to create
and dispose its test databases. Do not point test commands at production. No
reset, shared-schema deletion or trigger disabling is needed. Chromium revision
1248 is already installed in this execution environment; install it with
`pnpm --filter @ancastle/web exec playwright install chromium` if absent.

Run from the repository root:

```bash
pnpm --filter @ancastle/api db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

The focused command executed for this card was:

```bash
pnpm --filter @ancastle/api test -- src/modules/poultry/flocks.integration.spec.ts src/modules/poultry/feed-usage.integration.spec.ts src/modules/poultry/flock-metrics.integration.spec.ts src/modules/poultry/flock-metrics.spec.ts src/database/flock.persistence.spec.ts src/database/mortality-event.persistence.spec.ts
```

Result: **48 tests in 6 files passed**, direct execution. These tests reuse owned
temporary databases or rollback-scoped persistence fixtures. The full-suite
wrapper below additionally points all M1-M3 fixtures at an owned database.

After `pnpm build`, the following one-off PowerShell invocation reuses the
**existing** compiled disposable helper and Playwright CLI. It creates no new
runner or test file. The helper first proves SQL replay into an empty owned
database. Because this helper does not create Prisma's migration journal, the
deployment CLI is checked in a separate fresh schema **inside that same owned
database**; it is not run against the already-populated public schema. Seeding,
Vitest and the management browser then use its public schema. Environment
overrides are limited to child processes, and cleanup always uses the helper's
guarded `dispose()`.

```powershell
@'
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { temporaryDatabase } from './apps/api/dist/test/temporary-database.js';

if (existsSync('.env')) {
  const values = parseEnv(readFileSync('.env', 'utf8'));
  for (const key of ['DATABASE_URL', 'REDIS_URL'])
    if (values[key] !== undefined) process.env[key] ??= values[key];
}
async function run(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd, env, stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Validation command failed');
}
const database = await temporaryDatabase();
try {
  const [{ name }] = await database.prisma.$queryRaw`SELECT current_database() AS name`;
  assert.match(name, /^poultry_test_[a-f0-9]{32}$/);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + name;
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const setupUrl = new URL(url);
  setupUrl.searchParams.set('schema', 'm4_setup_validation');
  const setupEnv = { ...env, DATABASE_URL: setupUrl.toString() };
  await run('pnpm', ['--filter', '@ancastle/api', 'db:migrate:deploy'], '.', setupEnv);
  await run('pnpm', ['--filter', '@ancastle/api', 'db:migrate:deploy'], '.', setupEnv);
  const [{ count }] = await database.prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS count FROM m4_setup_validation._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const migrations = readdirSync('apps/api/prisma/migrations', { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
  assert.equal(count, migrations);
  console.log('Verified committed deployment migrations:', count);
  await run('pnpm', ['--filter', '@ancastle/api', 'db:seed'], '.', env);
  const seeded = await database.prisma.organization.findUniqueOrThrow({
    where: { slug: 'ancastle-farms' }, include: { farms: true },
  });
  assert.equal(seeded.farms.length, 1);
  assert.equal(seeded.farms[0].code, 'MAIN');
  assert.equal(await database.prisma.user.count(), 0);
  console.log('Verified seed organization/farm; no login created');
  await run('pnpm', ['test', '--', '--maxWorkers=2'], '.', env);
  await run(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test', 'management.spec.ts',
    '--grep', 'manages farm flocks through real APIs',
  ], 'apps/web', env);
} finally {
  await database.dispose();
}
'@ | node --input-type=module
```

Then run the existing operational/indicator launcher, which owns a separate
temporary database and retains all posted ledger records until database disposal:

```bash
pnpm --filter @ancastle/web exec node e2e/run-poultry.mjs
git diff --check
git status --short
```

Browser invocations must run sequentially; both start their own production API,
test proxy and Next.js servers on ports 4310, 4311 and 3310 with server reuse
disabled. They require the existing PostgreSQL/Redis services. Screenshot, trace
and video capture remain disabled. No manual browser interaction is claimed.
Restricted Windows agents also need permission to terminate their own test server
processes. Do not work around unavailable teardown by killing arbitrary Node
processes or enabling reuse of unrelated running servers.

## Quality gates and outcome

The first default-concurrency `pnpm test` attempt failed on timing limits:
the feed/metrics suites' cleanup hooks and user suite's setup hook exceeded
10 seconds, and the M1 login-to-administration workflow exceeded 5 seconds.
API results were 358 passed, 1 timed out and 53 skipped after the setup failure;
web 109 and validation 148 passed. All individual poultry assertions passed,
but cleanup-hook failures mean that attempt is not a passing gate.

The rerun uses the existing Vitest `--maxWorkers=2` CLI option, with no assertion,
timeout or infrastructure changes. It creates another owned database and skips
repeating the already successful deployment/seed steps. The recipe above includes
all setup steps for a fresh reproduction and uses that worker limit.

The M4-08 browser assertions passed in 26.3 seconds. Its restricted Windows
invocation stalled during server teardown; process IDs, parent relationships and
commands were verified before stopping only its three servers and launching
shells. Playwright then reported **1 passed** and the wrapper completed disposal
with exit code 0. This was process cleanup, not manual UI verification. The
unchanged operational launcher was run with the required process permissions; both tests passed and normal server/database teardown completed with exit code 0.

| Gate                                                 | Result for M4-12                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm format:check`                                  | PASS, direct command                                                   |
| `pnpm lint`                                          | PASS command; 2 Turbo tasks cached                                     |
| `pnpm typecheck`                                     | PASS command; 4 Turbo tasks cached                                     |
| `pnpm test` (default workers)                        | FAIL: timing limits, documented above                                  |
| `pnpm test -- --maxWorkers=2` in disposable database | PASS, direct: API 412, web 109, validation 148; no cached test results |
| `pnpm build`                                         | PASS command; 4 Turbo tasks cached                                     |
| Existing M4-08 browser scenario                      | PASS, direct: 1 test; scoped Windows teardown assistance               |
| Existing M4-09/M4-10 browser scenarios               | PASS, direct: 2 tests; normal teardown                                 |
| `git diff --check`                                   | PASS                                                                   |

The earlier M4-11 report records passing local gates and 42 focused tests but no
browser rerun. That is inherited context only; the table above records this task's
execution separately. No prior browser result is substituted for a current run.

All validation scenarios A-H have passing local evidence using the existing
implementation and tests. No functional defect requiring a production/schema
change was demonstrated. The default-worker timing failure remains recorded;
the constrained full-suite run and all three browser scenarios passed. The
card's CI-green condition remains unverified for these uncommitted changes.

## Limitations and remaining risks

- CI status is **not executed/verified** for these uncommitted changes. The card's
  CI-green acceptance remains external; this task explicitly forbids commit/push.
  The current `.github/workflows/ci.yml` runs repository gates but does not invoke
  Playwright; local browser results must not be described as CI browser coverage.
- A clean dependency installation and starting new Docker volumes are not
  executed here. Validation uses installed pinned tools and available services;
  fresh database migration/seed validation is isolated as described above.
- Default-worker test timing was unreliable on this host. The full suite passed
  with two workers per Vitest invocation; default-worker/CI timing stability is
  not established by that constrained run. Existing timeout limits remain intact.
- The operator first-owner recipe remains inherited M1 documentation. Browser
  tests provision isolated fixture credentials and exercise real password login;
  they do not execute that operator recipe or claim manual provisioning validation.
- Internal reversal paths are tested without adding HTTP routes or UI. They do
  not define a public authorization surface for a future correction workflow.
- Current policy allows all four roles to read/post poultry; STAFF cannot manage
  definitions/lifecycle. A hypothetical read-only/no-posting role is not invented.
- The API provides actor IDs, not actor names. UI feed names are resolved from
  accessible inventory metadata, with a stable item-ID fallback.
- Metrics are current ledger totals, not historical as-of reports. Maturity is
  expected-date status, not biological confirmation or a health classification.
- Responsive evidence covers the existing Chromium scenarios and overflow
  assertions, not every device/browser, visual review or a full accessibility audit.
- Form reset/pending protection is not a server-side idempotency-key mechanism.

Changed files: `README.md`, `docs/m4-workflow.md` and this report. No new feature,
test matrix, schema migration or future-milestone work is included.
