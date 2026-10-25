# M1 developer workflow

This guide follows M1 from an empty local database to authenticated administration.
Use the versions pinned in the repository: Node.js 24, pnpm 12.15.0, PostgreSQL 17
and Redis 8. Run commands at the repository root unless stated otherwise.

## Identity and tenant ownership

An `Organization` is the tenant boundary and owns many `Farm` records. A farm
belongs to exactly one organization. Global `User` identity contains the normalized
unique email, Argon2id password hash and account lifecycle. `OrganizationMembership`
connects an identity to an organization with its own role, display name and active
status. A user can be OWNER in one organization and STAFF in another.

`FarmAccessAssignment` connects a membership to a farm in the same organization.
Composite foreign keys enforce matching ownership. Deactivation preserves stable
IDs and history. Organization administration changes memberships and their profiles;
it does not reset existing global passwords, email addresses or account status.
M1 creates new identities through administrator bootstrap; email invitation,
self-registration and password recovery are outside this milestone.

## Permissions and farm access

The authoritative policy is
[`role-permissions.ts`](../apps/api/src/modules/authorization/role-permissions.ts).
Controllers declare centralized permissions rather than comparing roles.

| Role    | Organization | Farms                        | Users and memberships                  | Operational farm access               |
| ------- | ------------ | ---------------------------- | -------------------------------------- | ------------------------------------- |
| OWNER   | Read/update  | Read/create/update/lifecycle | Read/create/profile/role/status/grants | All active farms in this organization |
| ADMIN   | Read/update  | Read/create/update/lifecycle | Read/create/profile/role/status/grants | All active farms in this organization |
| MANAGER | Read         | Read accessible farms        | Read only                              | Explicit active assignments           |
| STAFF   | Read         | Read accessible farms        | No administration                      | Explicit active assignments           |

OWNER and ADMIN currently have equivalent permissions. Role authority is always
organization-specific. Changes cannot remove the last active administrator;
serializable mutations revalidate the actor and preserve this invariant under
concurrency. MANAGER and STAFF can have zero, one or multiple farm assignments.

## Fresh local setup

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell).
   Set independent random JWT secrets of at least 32 characters. Keep
   `NODE_ENV=development`, `WEB_APP_URL=http://localhost:3000`, and
   `API_INTERNAL_URL=http://127.0.0.1:4000/api` for the default local ports.
   Check `DATABASE_URL` points to your intended local database and matches Docker.
3. Run `docker compose up -d` and wait for `docker compose ps` to show healthy
   PostgreSQL and Redis. Existing volumes are retained; an empty database is
   required to reproduce the fresh-setup validation below.
4. Generate the client, apply committed migrations, seed local organization/farm
   data, and build the applications/shared packages:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
pnpm --filter @ancastle/api db:seed
pnpm build
```

Use `db:migrate` when developing a new schema migration. Fresh setup applies the
committed migration chain with `db:migrate:deploy`; it never resets an existing
database. The seed upserts `ancastle-farms` and its `MAIN` farm and sets their
names/active flags to the development defaults. Run it only on local development
data. It does not create a user or a default password.

## Provision the first local owner

For a fresh local organization with no memberships, a trusted developer with
database access can run the one-time recipe below. This is operator provisioning;
there is no public bootstrap endpoint or authorization bypass. After this first
owner, use the protected Users administration UI/API to create other identities.

Save the following credential-free source as
`apps/api/.m1-bootstrap.local.mjs`. It uses the built password service and shared
validation. It refuses production/test mode, missing/inactive seed organizations,
any existing organization membership, and an existing email. It creates the new
identity and OWNER membership atomically; it never resets or reuses an identity.
Concurrent attempts can cause a safe transaction failure; inspect local state
before retrying rather than resetting it.

```javascript
import { PrismaService } from './dist/database/prisma.service.js';
import { PasswordService } from './dist/modules/auth/password.service.js';
import { bootstrapOrganizationUserSchema } from '@ancastle/validation';

let prisma;
try {
    if (process.env.NODE_ENV !== 'development') throw new Error();
    const parsed = bootstrapOrganizationUserSchema.safeParse({
        email: process.env.BOOTSTRAP_EMAIL,
        password: process.env.BOOTSTRAP_PASSWORD,
        role: 'OWNER',
    });
    if (!parsed.success) throw new Error();
    const { email, password } = parsed.data;
    const passwordHash = await new PasswordService().hash(password);
    prisma = new PrismaService();
    await prisma.$transaction(
        async (tx) => {
            const organization = await tx.organization.findFirst({
                where: { slug: 'ancastle-farms', isActive: true },
                select: { id: true },
            });
            if (!organization) throw new Error();
            const memberships = await tx.organizationMembership.count({
                where: { organizationId: organization.id },
            });
            if (memberships !== 0) throw new Error();
            const user = await tx.user.create({
                data: { email, passwordHash },
                select: { id: true },
            });
            await tx.organizationMembership.create({
                data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
            });
        },
        { isolationLevel: 'Serializable' },
    );
    console.log('Created initial local owner.');
} catch {
    console.error(
        'Local owner bootstrap failed. Check local configuration and provisioning state.',
    );
    process.exitCode = 1;
} finally {
    await prisma?.$disconnect().catch(() => {
        process.exitCode = 1;
    });
}
```

Supply an email and a unique 12–128 character password without putting them in
command arguments or committing them. In PowerShell:

```powershell
$env:BOOTSTRAP_EMAIL = Read-Host 'Local owner email'
$bootstrapSecure = Read-Host 'Local owner password' -AsSecureString
$bootstrapPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($bootstrapSecure)
try {
    $env:BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bootstrapPointer)
    pnpm --filter @ancastle/api exec node --env-file=../../.env .m1-bootstrap.local.mjs
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bootstrapPointer)
    $bootstrapSecure.Dispose()
    Remove-Item Env:BOOTSTRAP_PASSWORD, Env:BOOTSTRAP_EMAIL -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath apps/api/.m1-bootstrap.local.mjs
```

In Bash:

```bash
read -rp 'Local owner email: ' BOOTSTRAP_EMAIL
read -rsp 'Local owner password: ' BOOTSTRAP_PASSWORD; printf '\n'
export BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
pnpm --filter @ancastle/api exec node --env-file=../../.env .m1-bootstrap.local.mjs
unset BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
rm apps/api/.m1-bootstrap.local.mjs
```

Expect only `Created initial local owner.` on success. Failures expose no email,
password, hash or database error. A repeated run fails without changing the account.
The schema normalizes the email. OWNER receives all active organization farms via
the centralized permission policy and does not need duplicate assignment rows.

## Start and validate the application

Run `pnpm dev`. Open exactly `http://localhost:3000` for the default origin;
using `127.0.0.1` instead changes the origin and can reject Server Actions. Check
`http://localhost:4000/health` returns 200. Next.js development mode also requires
the web runtime values; the existing web command loads root `.env`.

1. Visit `/app/dashboard` without a cookie: expect `/login` and no protected data.
2. Log in with the local owner. Expect the protected shell, organization identity,
   Main Farm selection and dashboard. Reload and navigate to verify persistence.
3. In Organization settings, change the name and confirm it persists. In Farms,
   create a uniquely coded farm, edit it, deactivate it, filter inactive farms,
   and reactivate it. These are organization management operations; inactive farms
   cannot become operational context.
4. In Users, create a new STAFF identity with a unique email, initial password,
   organization display name and one farm grant. Confirm safe detail responses and
   that credentials are not redisplayed. Change its profile, role and farm grants
   to zero/one/multiple farms; deactivate/reactivate its membership.
5. In a separate browser session, log in as STAFF. Confirm only assigned active
   farms appear, user administration and mutation controls are unavailable, and
   changing URL/body IDs cannot select another farm or organization. Change the
   role to MANAGER and verify read-only user administration; revoke a grant or
   membership and verify the next request rejects stale access.
6. Use the automated two-organization tests below to verify foreign IDs produce
   safe failures and do not read/write another tenant. A stronger role in one
   organization must not authorize another. Last-administrator safeguards must
   reject the final administrative demotion/deactivation.
7. Log out and revisit protected routes: expect login. Repeat with an expired or
   revoked refresh session; authentication must fail safely without exposing tokens.

## Authentication and session behavior

NestJS remains the authority for Argon2id verification, access JWTs, hashed
PostgreSQL refresh sessions, rotation and revocation. Default access TTL is 900
seconds and refresh TTL is 604800 seconds. Refresh JWTs are unique per issuance;
atomic hash replacement permits one redemption even under concurrent requests.
Old rotated tokens fail. Inactive identities, memberships and organizations are
checked server-side. Authentication establishes identity; authorization verifies
the current organization/farm on each protected operation.

Next.js stores access/refresh tokens only in Redis. The browser receives a random
opaque HttpOnly, SameSite=Lax cookie, with Secure and the `__Host-` prefix on HTTPS.
Local HTTP uses `ancastle-session`. No API tokens belong in browser storage, client
props or logs. `WEB_SESSION_TTL_SECONDS` bounds the absolute browser session to at
most seven days. Refresh coordination uses a Redis lease and versioned replacement.
Loss of stored Redis state or expiry requires sign-in; sessions do not extend indefinitely.
Logout consumes Redis state and revokes the backend session when available. During
an API outage, local logout still succeeds, but the backend session can remain
valid until its expiry; access JWTs are not immediately revoked by logout and
remain bounded by their TTL. See the README authentication section for details.

Match `WEB_APP_URL` to the exact browser origin. `API_INTERNAL_URL` is server-only.
Keep PostgreSQL/Redis reachable and never prefix token or secret variables with
`NEXT_PUBLIC_`. Do not enable request-body or authorization-header logging.

## Scoping future modules

Use existing primitives in this order:

1. `AuthGuard` establishes `request.user` from verified authentication.
2. `AuthorizationGuard`, `@OrganizationParam()` and `@RequirePermissions(...)`
   verify active membership/organization and centralized permissions. Route IDs
   are selectors, not proof of access. `@CurrentOrganization()` fails closed if
   trusted context is absent.
3. Query organization-owned rows using `organizationContext.scope({ id })`.
   Its AND predicate preserves organization ownership with OR/NOT filters. Create
   records with ownership taken from this context, explicitly selecting allowed
   payload fields. Never spread an arbitrary body over ownership fields.
4. For operational records add `FarmAccessGuard` and `@CurrentFarm()` after
   organization authorization. `farmContext.scope({ id })` constrains both
   `organizationId` and `farmId`. Validate assignment and lifecycle on the server;
   selected URLs, headers, cookies, user IDs and payload roles grant no authority.
5. Apply the same scope to reads, writes, counts, relations and transactions.
   Perform ownership checks in scoped queries and return safe indistinguishable
   foreign/not-found failures where appropriate. Database ownership constraints
   complement these checks. Avoid unscoped fetch-then-check patterns.
6. Use shared Zod contracts, explicit safe DTO selections, the existing validation
   pipe/business exceptions, and tests for unauthenticated, forbidden, inactive,
   malformed and cross-tenant requests, including injected body IDs.

Organization/farm management uses organization authorization and access-aware farm
queries; it is distinct from operational record selection. UI visibility helps
navigation, while backend guards and scoped queries enforce access. Global identity
administration is not granted by organization membership permissions.

## Repeatable automated validation

Use a dedicated migrated local test database. The suites create unique fixtures
and clean those fixtures; never point them at production. From the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @ancastle/web exec playwright install chromium
pnpm --filter @ancastle/web test:e2e
```

Run API/root tests and browser tests sequentially against a shared database. CI
uses an empty PostgreSQL/Redis service, frozen installation, Prisma generation,
migration deployment, all gates and the Chromium suite. Browser tests start their
own production API/web servers on 4310/4311/3310; keep those ports free. Screenshot,
video and trace capture are disabled to avoid persisting credential artifacts.

| Evidence                                                        | What it verifies                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/database/*.spec.ts`                               | Ownership, uniqueness and lifecycle constraints                                                                          |
| `apps/api/src/modules/security/m1-security.integration.spec.ts` | Real login through administration, lifecycle, role separation, organization/farm isolation and sensitive-field exclusion |
| `apps/api/src/modules/auth/refresh-session*.spec.ts`            | Unique atomic refresh rotation, replay/logout, concurrency and compatibility                                             |
| `apps/web/e2e/auth.spec.ts`                                     | Login/logout, protected routes, opaque cookies, expiry/revocation, outages and token non-disclosure                      |
| `apps/web/e2e/shell.spec.ts`                                    | Single/multiple/zero farm choices, multi-organization context, tampering and lifecycle                                   |
| `apps/web/e2e/management.spec.ts`                               | Organization updates, farm creation/editing/lifecycle, permissions and foreign IDs                                       |
| `apps/web/e2e/users.spec.ts`                                    | User bootstrap/profile/roles/grants/status, tenant isolation and last-administrator restrictions                         |

M1-13 also executed negative controls: temporarily removing organization scope
exposed a foreign user and removing farm scope exposed an adjacent farm record.
Both corresponding assertions failed (200 instead of 404); original production
files were restored and the full suite passed. Do not commit intentionally weakened
security predicates.

## Execution record

Validated on 2026-10-25 with Node.js 24.22.1 and pnpm 12.15.0 on Windows,
PostgreSQL 17 and Redis 8. A new isolated database was created without resetting
existing development data. The existing checkout used a frozen-lockfile install;
clean-checkout installation and fresh service startup are also exercised by CI.

- Prisma generation succeeded; all five committed migrations applied to the empty
  database and the seed created Ancastle Farms / Main Farm with no user identity.
- The JavaScript recipe above was extracted and executed unchanged against that
  database. Seventeen assertions verified mode/config/input refusals, missing and
  inactive seed organizations, existing-identity preservation, normalized email,
  Argon2id verification, single-winner concurrent provisioning, rollback of the
  losing identity, no unnecessary farm grants and unchanged state on repeat runs.
- All 40 existing production browser scenarios passed against the isolated database,
  including organization/farm lifecycle, user/role/grant administration, stale
  permissions, cross-tenant attempts, session security and responsive layouts.
- An additional disposable browser check used the recipe-created owner to verify
  unauthenticated redirection, real password login, dashboard/Main Farm context,
  organization/farm/user administration access, logout and protected-route rejection.
  It passed separately with a cold-server wait and visible-header selectors.
  Temporary bootstrap/browser sources were removed afterward.

The five required root gates are run before this card is merged. CI/security
status and the final PR/merge reference are recorded on the M1-14 Trello card.
