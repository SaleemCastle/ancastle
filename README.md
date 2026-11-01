# Ancastle Farms

Ancastle Farms is a farm-management platform designed to support the operational and administrative needs of modern farms.

The platform is being developed to manage areas including:

- Farms and organizations
- Flocks and poultry operations
- Inventory and stock movements
- Assets
- Customers
- Suppliers
- Orders and fulfilment
- Deliveries
- Invoices
- Payments
- Expenses
- Purchasing
- Reporting
- Notifications
- Administration

The project is structured as a pnpm/Turborepo monorepo containing a Next.js web application, NestJS API, shared TypeScript packages, and PostgreSQL/Redis infrastructure.

---

## Technology Stack

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui

### Backend

- NestJS 12
- TypeScript
- Prisma 7
- PostgreSQL 17
- Redis 8
- Pino structured logging
- Zod validation
- Vitest
- Oxlint

### Development Infrastructure

- Node.js 24
- pnpm 12.15.0
- Turborepo
- Docker
- Docker Compose
- GitHub Actions

---

## Repository Structure

```text
ancastle-farms/
├── apps/
│   ├── web/                  # Next.js frontend
│   └── api/                  # NestJS backend
│
├── packages/
│   ├── ui/                   # Shared UI components
│   ├── types/                # Shared TypeScript/API contracts
│   ├── validation/           # Shared Zod schemas
│   └── config/               # Shared configuration
│
├── docker/                   # Docker-related resources
├── .github/
│   └── workflows/
│       └── ci.yml            # Continuous integration
│
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

---

# Local Development

## Prerequisites

Install the following before running Ancastle Farms locally:

- Git
- Node.js 24
- pnpm 12.15.0
- Docker Desktop

The repository declares its expected pnpm version through the root `package.json`.

Verify the required tooling:

```bash
node --version
pnpm --version
docker --version
docker compose version
git --version
```

---

## M1 Identity, Access and Administration

Follow the [M1 developer workflow](docs/m1-workflow.md) for fresh migrations,
first-owner provisioning, session behavior, permissions, tenant/farm scoping and
end-to-end validation. The default seed creates organization/farm data only.

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ancastle-farms
```

Replace `<repository-url>` with the Git repository URL for the project.

---

### 2. Install Dependencies

Install all workspace dependencies from the repository root:

```bash
pnpm install
```

For an installation that strictly uses the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

The frozen-lockfile installation is also used by CI.

---

### 3. Configure the Environment

Create the local environment file from `.env.example`.

#### macOS/Linux

```bash
cp .env.example .env
```

#### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

Review the resulting `.env` file before starting the applications.

The local environment contains configuration for services including:

- PostgreSQL
- Redis
- API
- Web application
- Authentication secrets
- Application logging

Never commit real credentials, tokens, passwords, or production secrets to `.env`.

---

## Local Development Infrastructure

PostgreSQL and Redis run in Docker during local development.

The Next.js web application and NestJS API run directly through Node.js and pnpm.

### Start Infrastructure

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Check their status:

```bash
docker compose ps
```

Both infrastructure services should eventually report a healthy state.

### View Infrastructure Logs

PostgreSQL:

```bash
docker compose logs postgres
```

Redis:

```bash
docker compose logs redis
```

Follow logs continuously:

```bash
docker compose logs -f
```

### Stop Infrastructure

```bash
docker compose down
```

Normal `docker compose down` does not delete the named PostgreSQL and Redis volumes.

---

# Running the Applications

## Generate the Prisma Client

After installing dependencies, generate the Prisma client:

```bash
pnpm --filter @ancastle/api db:generate
```

---

## Start the Development Environment

From the repository root:

```bash
pnpm dev
```

Turborepo builds the shared ESM packages before starting the application processes and shared-package watchers.

The development environment consists of:

| Service         | Runtime           |
| --------------- | ----------------- |
| Web application | Next.js / Node.js |
| API             | NestJS / Node.js  |
| PostgreSQL      | Docker            |
| Redis           | Docker            |

The API runs on port `4000` by default.

```text
http://localhost:4000
```

The API infrastructure health endpoint is:

```text
GET http://localhost:4000/health
```

---

## Run Applications Individually

### API

```bash
pnpm --filter @ancastle/api dev
```

### Web Application

```bash
pnpm --filter @ancastle/web dev
```

Build shared packages first with `pnpm exec turbo run build --filter=@ancastle/types --filter=@ancastle/validation` when running an application directly. Root `pnpm dev`, `pnpm test` and `pnpm build` handle this dependency automatically.

---

# Database and Prisma

Ancastle Farms uses PostgreSQL for relational persistence and Prisma as its database ORM/tooling layer.

## Start PostgreSQL Only

```bash
docker compose up -d postgres
```

## Generate Prisma Client

```bash
pnpm --filter @ancastle/api db:generate
```

## Create and Apply a Development Migration

```bash
pnpm --filter @ancastle/api db:migrate
```

## Apply Existing Migrations

For deployment-style migration execution:

```bash
pnpm --filter @ancastle/api db:migrate:deploy
```

## Open Prisma Studio

```bash
pnpm --filter @ancastle/api db:studio
```

## Persistence Boundary

Prisma-generated models belong exclusively to the API persistence layer.

They must not be imported directly into the frontend or exposed as the application's public API contracts.

Data leaving the backend should be mapped to explicit shared API contracts.

---

# Redis

Redis provides application infrastructure for functionality requiring shared, temporary, cached, or asynchronous state.

## Start Redis Only

```bash
docker compose up -d redis
```

## Check Redis Status

```bash
docker compose ps
```

The API verifies Redis connectivity during startup and through the application health endpoint.

The Redis client uses reconnect backoff so that an already-running API can recover when Redis becomes temporarily unavailable and later returns.

---

# Shared Packages

## `@ancastle/types`

`@ancastle/types` contains reusable TypeScript types and API contracts shared between the frontend and backend.

Examples include:

- API response contracts
- Request/response types
- Shared enums
- Shared primitives
- Domain-facing DTO types

Database persistence models generated by Prisma must not be exposed through this package.

---

## `@ancastle/validation`

`@ancastle/validation` contains reusable Zod schemas for validating data at application boundaries.

Examples include:

- API request validation
- API response validation
- Form validation
- Shared field schemas

The validation package remains independent of Prisma and database implementation details.

---

## Application Boundary

The intended application boundary is:

```text
PostgreSQL
    ↓
Prisma persistence models
    ↓
NestJS API
    ↓
Shared API contracts / validation
    ↓
Next.js frontend
```

Prisma models belong to the API persistence layer and must not be imported directly by the frontend.

---

# API Response Conventions

Ancastle Farms uses consistent response and error formats across business API endpoints.

## Successful Response

Single-resource and command responses use a `data` envelope:

```json
{
    "data": {
        "id": "123"
    }
}
```

The shared TypeScript contract is `ApiResponse<T>` from `@ancastle/types`.

---

## Paginated Collections

Paginated endpoints return their collection in `data` and pagination information in `meta`.

```json
{
    "data": [],
    "meta": {
        "page": 1,
        "pageSize": 20,
        "totalItems": 57,
        "totalPages": 3
    }
}
```

The shared contract is `PaginatedResponse<T>`.

---

## Validation Errors

Request validation failures use the `VALIDATION_ERROR` code and may provide field-level messages.

```json
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Validation failed",
        "fields": {
            "email": ["Invalid email address"],
            "name": ["Name is required"]
        }
    }
}
```

Zod schemas should be used with the shared `ZodValidationPipe` for API boundary validation.

---

## Business Rule Errors

Domain and business-rule failures expose stable machine-readable error codes.

```json
{
    "error": {
        "code": "INSUFFICIENT_STOCK",
        "message": "There is insufficient stock to fulfil this order"
    }
}
```

Business services should throw `BusinessException` with an appropriate HTTP status and stable error code.

Error codes should describe the business condition rather than implementation details.

Examples include:

- `CUSTOMER_NOT_FOUND`
- `INSUFFICIENT_STOCK`
- `ORDER_ALREADY_FULFILLED`
- `INVOICE_ALREADY_PAID`

---

## HTTP Errors

Standard HTTP exceptions are converted to the common error envelope.

```json
{
    "error": {
        "code": "NOT_FOUND",
        "message": "Customer was not found"
    }
}
```

---

## Internal Errors

Unexpected server errors return a sanitized response.

```json
{
    "error": {
        "code": "INTERNAL_SERVER_ERROR",
        "message": "An unexpected error occurred"
    }
}
```

Internal exception messages and stack traces must never be exposed to API clients.

Server-side structured logging is handled separately from the client response.

---

## Health Endpoint Exception

`/health` is an infrastructure endpoint and is not required to use the normal business API `data` envelope.

---

# API Health Check

The API exposes an infrastructure health endpoint:

```text
GET /health
```

For local development:

```text
GET http://localhost:4000/health
```

The health check verifies:

- API availability
- PostgreSQL connectivity
- Redis connectivity

## Healthy Response

When all critical dependencies are available, the endpoint returns HTTP `200`.

Example:

```json
{
    "status": "ok",
    "service": "ancastle-api",
    "timestamp": "2026-10-24T20:00:08.746Z",
    "dependencies": {
        "database": "up",
        "redis": "up"
    }
}
```

## Unhealthy Response

If PostgreSQL or Redis is unavailable, the endpoint returns HTTP `503`.

Example:

```json
{
    "status": "error",
    "service": "ancastle-api",
    "timestamp": "2026-10-24T20:00:57.245Z",
    "dependencies": {
        "database": "up",
        "redis": "down"
    }
}
```

The endpoint intentionally does not expose:

- Database URLs
- Redis URLs
- Credentials
- Hostnames
- Exception messages
- Stack traces
- Other sensitive infrastructure information

The endpoint is intended for:

- Container health checks
- Load balancers
- Deployment platforms
- Monitoring systems

---

# Application Logging

The Ancastle Farms API uses Pino through `nestjs-pino` for structured application and HTTP request logging.

## Log Levels

The active log level is controlled through the environment.

```env
LOG_LEVEL=info
```

Development environments may use `debug`.

Production environments should normally use `info` or a more restrictive level.

---

## Structured Context

Prefer structured metadata instead of interpolating identifiers into log messages.

```ts
logger.log({
    customerId,
    orderId,
    message: 'Order created',
});
```

Logs should contain only the context necessary to diagnose or observe the operation.

---

## Sensitive Information

The following information must never be intentionally logged:

- Passwords
- Authorization headers
- Cookies
- Access tokens
- Refresh tokens
- Authentication secrets
- Database credentials
- Other sensitive credentials

The logger configures redaction for known sensitive fields as an additional defensive measure.

Avoid logging entire request bodies or DTOs.

---

## Error Logging

Expected validation, business-rule, and ordinary HTTP errors are returned through the standard API error convention without automatically generating unnecessary error-level logs.

Unexpected server exceptions are logged with diagnostic information on the server while clients receive the sanitized `INTERNAL_SERVER_ERROR` response.

---

## HTTP Request Logging

HTTP requests are logged automatically with structured context including information such as:

- Request ID
- HTTP method
- URL
- Response status
- Response time

Direct `console.log` should not be used as the production application logging strategy.

---

# Development Quality Checks

Run repository quality checks before opening a pull request.

## Formatting

Format supported repository files:

```bash
pnpm format
```

Verify formatting without modifying files:

```bash
pnpm format:check
```

---

## Linting

```bash
pnpm lint
```

---

## Type Checking

```bash
pnpm typecheck
```

---

## Tests

```bash
pnpm test
```

---

## Production Build

```bash
pnpm build
```

---

## Full Local Validation

Run the primary quality gates together before submitting work:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All checks should pass before a pull request is considered ready for review.

---

# Continuous Integration

GitHub Actions validates repository quality on:

- Pull requests targeting `main`
- Pushes to `main`

The CI pipeline performs:

1. Repository checkout
2. pnpm setup
3. Node.js setup
4. Dependency installation using the committed lockfile
5. Prisma client generation
6. Prettier formatting verification
7. Linting
8. TypeScript type checking
9. Automated tests
10. Production builds

CI failures should be corrected rather than bypassed.

To reproduce the primary CI quality gates locally:

```bash
pnpm install --frozen-lockfile
pnpm --filter @ancastle/api db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

# Troubleshooting

## PostgreSQL or Redis Is Not Available

Check Docker:

```bash
docker compose ps
```

Start the infrastructure if necessary:

```bash
docker compose up -d
```

Inspect PostgreSQL logs:

```bash
docker compose logs postgres
```

Inspect Redis logs:

```bash
docker compose logs redis
```

---

## Health Endpoint Returns HTTP 503

Check:

```text
GET http://localhost:4000/health
```

HTTP `503` means at least one critical dependency is currently unavailable.

Check Docker infrastructure:

```bash
docker compose ps
```

The health response identifies whether PostgreSQL or Redis is currently unavailable without exposing sensitive connection details.

Once the affected dependency recovers, `/health` should return HTTP `200`.

---

## Redis Was Restarted

The Redis client uses reconnect backoff during runtime.

If Redis becomes unavailable after the API has started, `/health` should report Redis as `down`.

Once Redis becomes available again and the client reconnects, `/health` should automatically report Redis as `up` without requiring a normal API restart.

---

## Prisma Client Is Missing or Outdated

Generate the Prisma client:

```bash
pnpm --filter @ancastle/api db:generate
```

This may be necessary after:

- Initial dependency installation
- Prisma schema changes
- Cleaning generated files

---

## Environment Validation Fails During API Startup

The API validates required environment variables before NestJS starts.

Ensure `.env` exists.

### macOS/Linux

```bash
cp .env.example .env
```

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

Compare `.env` with `.env.example` and ensure all required values are configured.

Do not solve missing configuration by disabling environment validation.

---

## Port Already in Use

Check whether another process or container is already using the configured port.

For Docker services:

```bash
docker compose ps
```

Stop conflicting development processes or adjust the appropriate local environment configuration when necessary.

---

## Dependency or Lockfile Problems

Install dependencies normally:

```bash
pnpm install
```

CI uses:

```bash
pnpm install --frozen-lockfile
```

If the frozen-lockfile installation fails, the committed `pnpm-lock.yaml` may not match the workspace package manifests.

The lockfile should be corrected and committed rather than bypassing the frozen-lockfile requirement in CI.

---

## Docker Infrastructure Needs to Be Restarted

```bash
docker compose down
docker compose up -d
```

This preserves the named Docker volumes.

---

## Completely Reset Local Docker Data

If a complete local database and Redis data reset is intentionally required:

```bash
docker compose down -v
docker compose up -d
```

> **Warning:** `docker compose down -v` permanently removes the project's local PostgreSQL and Redis Docker volume data.

Do not use this command unless deleting local development data is intentional.

---

## Docker Service Is Still Starting

Immediately after starting infrastructure:

```bash
docker compose ps
```

may temporarily show:

```text
health: starting
```

Wait for the service health checks to complete before diagnosing it as a failure.

---

# Clean Local Setup Validation

A new contributor should be able to clone the repository and reach a running development environment without undocumented manual configuration.

The basic M0 setup flow is:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

On Windows PowerShell, use:

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d
pnpm dev
```

If the Prisma client has not yet been generated, run:

```bash
pnpm --filter @ancastle/api db:generate
```

Expected running components are:

- Next.js web application
- NestJS API
- PostgreSQL
- Redis

Verify infrastructure:

```bash
docker compose ps
```

Verify API health:

```text
GET http://localhost:4000/health
```

A correctly configured environment with healthy PostgreSQL and Redis dependencies should return HTTP `200`.

---

# Development Workflow

A typical development workflow is:

1. Update local `main`.
2. Create a feature branch.
3. Implement the required change.
4. Add or update automated tests.
5. Run formatting.
6. Run linting.
7. Run type checking.
8. Run tests.
9. Run the production build.
10. Commit and push the feature branch.
11. Open a pull request.
12. Ensure CI passes before merging.

Example:

```bash
git checkout main
git pull origin main
git checkout -b feature/example
```

Before pushing:

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

# Architecture Principles

The project follows several important architectural boundaries.

## Organization and Farms

The platform is designed around an organization that may contain one or more farms.

Organization-level data can include areas such as:

- Users
- Customers
- Suppliers
- Orders
- Invoices
- Payments
- Settings

Farm-specific operational data is associated with the appropriate farm.

---

## Inventory

Inventory uses a ledger-oriented model.

Inventory quantities should be derived from stock movements rather than directly and arbitrarily modifying a quantity field.

The inventory domain is designed around concepts including:

```text
Inventory Item
      ↓
Inventory Batch
      ↓
Stock Movement
```

Stock movements provide an auditable record of inventory changes.

---

## Poultry Operations

Poultry-specific operational data is represented separately from generic inventory.

Core concepts include:

- Flocks
- Mortality events
- Feed usage

---

## Commerce

The commerce lifecycle separates orders, fulfilment, invoicing, and payments.

```text
Order
  ↓
Fulfilment
  ↓
Invoice
  ↓
Payment
```

An order is not the same thing as an invoice, and payment records should remain separate from invoice records.

Payment allocation allows payments to be applied to the appropriate receivables.

---

## Ledger-Oriented Design

The platform conceptually maintains three important operational ledgers:

1. Inventory ledger
2. Customer ledger
3. Financial ledger

This approach supports auditability, reporting, statements, aging, reconciliation, and future financial functionality.

---

# Security Principles

Development should follow these baseline rules:

- Never commit secrets.
- Never expose internal exception details to clients.
- Never expose Prisma persistence models directly as public API contracts.
- Validate data at application boundaries.
- Use stable business error codes.
- Avoid logging sensitive request data.
- Keep authentication secrets outside source control.
- Apply authorization at protected application boundaries.
- Treat financial and inventory operations as auditable business events.

---

# Current Project Status

The M0 Project Foundation establishes the technical foundation for future Ancastle Farms development.

Foundation capabilities include:

- pnpm/Turborepo monorepo
- Next.js web application
- NestJS API
- PostgreSQL
- Prisma
- Redis
- Docker Compose infrastructure
- Shared TypeScript contracts
- Shared Zod validation
- API response/error conventions
- Structured application logging
- Environment validation
- Repository quality tooling
- GitHub Actions CI
- PostgreSQL/Redis-aware application health checks
- Local developer onboarding documentation

Future milestones build the farm-management domain functionality on top of this foundation.

---

# Organization Request Context and Tenant Isolation

Access tokens identify a user, not a universal organization role. Organization selection
continues to use the route parameter established by M1-04. The route ID is only a selector:
`AuthorizationGuard` looks up the authenticated user's membership in that organization on
every scoped request, checks membership and organization lifecycle state, and evaluates
permissions using that membership's current role. It never uses body, query, or header IDs,
roles, membership IDs, or permission claims as authorization evidence. There is no default
organization or fallback to the user's first/strongest membership.

Apply `@UseGuards(AuthGuard, AuthorizationGuard)` in that order. Declare
`@OrganizationParam()` (or a custom route parameter name) to require context even on
endpoints without additional permissions. Existing `@RequirePermissions(...)` endpoints
also require context, using `organizationId` by default. Both decorators support controller
and method metadata. Import `AuthModule` and `AuthorizationModule` in consuming modules.

`AuthorizationGuard` attaches an immutable `request.organizationContext` after successful
checks. `@CurrentOrganization()` retrieves it and fails closed when it is absent. The
context exposes only `organizationId`, `membershipId`, `userId`, and the selected
membership's `role`; it is an internal server type, not a public API or input DTO. Do not
construct it from request payloads or serialize it as an application response.

Future domain services should accept the verified context explicitly:

```ts
@UseGuards(AuthGuard, AuthorizationGuard)
@OrganizationParam()
@Controller('organizations/:organizationId/example')
export class ExampleController {
    @Get(':id')
    @RequirePermissions(Permission.FARM_READ)
    read(@CurrentOrganization() context: OrganizationContext, @Param('id') id: string) {
        return this.service.read(context, id);
    }
}
```

Validate resource IDs and DTOs with Zod before querying. For organization-owned records,
use `context.scope(filters)` in the database query:

```ts
const farm = await prisma.farm.findFirst({
    where: context.scope({ id: resourceId }),
    select: { id: true, name: true },
});
if (!farm) {
    throw new BusinessException('FARM_NOT_FOUND', 'Farm was not found', 404);
}
```

The helper combines filters and authoritative `organizationId` with `AND`, so `OR`,
`NOT`, or conflicting ownership filters cannot widen the tenant boundary. Use the same
scope for lists, counts, aggregates, relations and writes. For the Organization record
itself, constrain its primary `id` to `context.organizationId`; it has no
`organizationId` column. For creation, explicitly select allowed input fields and assign
ownership from context. Never spread an arbitrary payload into persistence data.

Updates should include resource ID and organization ownership in the write predicate.
For example, `updateMany({ where: context.scope({ id }), data: validatedFields })`
allows a zero count to become the same sanitized not-found error as a missing record,
without a preceding unscoped lookup. Never allow update data to replace tenant ownership.
Scope related-record lookups as well; a scoped parent alone does not validate a supplied
foreign key.

Missing/malformed organization selection, absent/inactive membership, inactive
organization, and insufficient permissions return the same sanitized `403 FORBIDDEN`.
Authentication failures remain `401` through `AuthGuard`. Inaccessible resource IDs
within a valid scope must return the same `404` envelope as nonexistent IDs. Avoid
unscoped existence checks and raw Prisma exceptions in public responses.

Organization membership does not imply access to every farm. M1-06 adds assignment-based
farm context and M1-07 adds management APIs; neither is introduced by M1-05. Future
background jobs must also resolve and verify authoritative context before calling
tenant-scoped services.

`organization-isolation.integration.spec.ts` runs with `pnpm test` using the migrated
PostgreSQL database configured by `DATABASE_URL` (local setup loads the root `.env`).
It uses isolated UUID fixtures and test-only HTTP controllers, real JWT verification,
the production guards/decorator/scoping helper, and real Prisma queries. It checks
read/write boundaries, role separation across memberships, spoofed payloads, inactive
states, indistinguishable failures, and concurrent organization requests.

---

# Farm Access Assignments and Context

Farm access belongs to an organization membership, not globally to a user.
`FarmAccessAssignment` stores a UUID, organization, membership, farm, active state,
and creation/update timestamps. A membership can have multiple farm assignments;
a farm can have assignments for multiple memberships. The membership/farm pair is
unique. Revoke/reactivate using `isActive`, retaining the same assignment identity.

Composite foreign keys link both membership and farm through `organizationId`.
PostgreSQL rejects cross-organization assignments, nonexistent references, and
reparenting an assigned farm/membership into another organization. The composite
unique indexes on the parents support those foreign keys. Deletion is restricted
while assignments reference the parent records.

The central policy grants `farm:access-all` (`Permission.FARM_ACCESS_ALL`) to
OWNER and ADMIN memberships. They can select all active farms in their organization
without creating duplicate per-farm assignments. MANAGER and STAFF memberships
require an active assignment for each selected farm. Farm access does not grant
write permissions; the existing permission guard still evaluates every declared
action. A role in one organization never grants farm access in another.

`FarmAccessService.farmWhere(context)` returns a Prisma predicate for accessible,
active Farm records. It constrains organization ownership and current membership,
role and lifecycle state, and includes an active assignment restriction unless
the verified membership has organization-wide farm access. Use it for farm
selectors and operational farm lists. No assignments yields an empty list while
organization-level operations remain available. `resolve(context, selectedFarmId)`
validates a UUID selection with that predicate and returns an immutable
`FarmContext`.

Use the existing module and guards in this order:

```ts
@UseGuards(AuthGuard, AuthorizationGuard, FarmAccessGuard)
@OrganizationParam()
@FarmParam() // defaults to the farmId route parameter
@RequirePermissions(Permission.FARM_READ)
@Controller('organizations/:organizationId/farms/:farmId/example')
export class FarmExampleController {
    @Get()
    read(
        @CurrentOrganization() organization: OrganizationContext,
        @CurrentFarm() farm: FarmContext,
    ) {
        return this.service.read(organization, farm);
    }
}
```

Import `AuthModule` and `AuthorizationModule`; the latter exports both farm
access providers. `@FarmParam('selectedFarm')` supports a custom route parameter
on a controller or method. `@CurrentFarm()` fails closed when verified farm
context is absent. `FarmAccessGuard` also rejects missing/mismatched authenticated
identity and organization context. Never construct either context from a payload
or cache it across requests.

For operational records with both ownership columns, use
`farm.scope({ id: resourceId })`. It combines filters with verified
`organizationId` and `farmId` using AND. For a Farm record itself, constrain its
primary `id` to `farm.farmId` and its `organizationId` to
`farm.organizationId`. Explicitly select allowed fields for writes and derive
ownership from context; neither assignment authorization nor a scoped predicate
makes arbitrary persistence data safe.

Missing/malformed, nonexistent, foreign, unassigned and inactive farm selections
all return the same sanitized `403 FORBIDDEN`. Inactive assignments, memberships,
users and organizations cannot establish operational farm context. Authentication
failures retain the existing `401` behavior. Body, query and header IDs/roles never
select or authorize a farm. Selecting an inactive farm is denied even to an
administrator; administrative lifecycle management is a separate organization-level
operation under its own permissions.

M1-06 adds reusable persistence and authorization behavior. Production management
endpoints belong to M1-07 and assignment administration to M1-08. Its test-only HTTP
controllers exercise the production module, guards, decorators, access predicates
and PostgreSQL constraints. The migration was verified against both the existing
development database and a fresh temporary database, including a zero-drift check.

---

# Organization and Farm Management API

The selected organization is represented in the route and verified against the
authenticated user's active membership before any operation. All endpoints require
a bearer access token and return the standard resource or paginated collection envelope.

| Method | Route                                              | Required permission   | Input                                             |
| ------ | -------------------------------------------------- | --------------------- | ------------------------------------------------- |
| GET    | `/api/organizations/:organizationId`               | `organization:read`   | —                                                 |
| PATCH  | `/api/organizations/:organizationId`               | `organization:update` | `{ name }`                                        |
| GET    | `/api/organizations/:organizationId/farms`         | `farm:read`           | Query: `page`, `pageSize`, `isActive`             |
| POST   | `/api/organizations/:organizationId/farms`         | `farm:create`         | `{ name, code }`                                  |
| GET    | `/api/organizations/:organizationId/farms/:farmId` | `farm:read`           | —                                                 |
| PATCH  | `/api/organizations/:organizationId/farms/:farmId` | `farm:update`         | Any nonempty subset of `{ name, code, isActive }` |

Organization profile updates support the name. Organization IDs, slugs, and lifecycle
state are read-only through these endpoints. Farm lifecycle uses
`PATCH { "isActive": false }` and `PATCH { "isActive": true }`; important records
and their assignments are retained.

Names are trimmed and must contain 1–120 characters. Farm codes are trimmed,
converted to uppercase, limited to 32 characters, and use letters, digits,
underscores or hyphens, beginning with a letter/digit. Codes are unique within
an organization; the same code can be used by a different organization.
The API derives creation ownership from verified context and selects writable
fields explicitly. Unknown body fields, including organization/farm/user IDs,
roles, permissions and membership IDs, are validation errors.

Farm list defaults are `page=1`, `pageSize=20`; maximum page size is 100 and
maximum page is 1,000,000. The optional `isActive` query accepts `true` or
`false`. Lists sort by code and stable ID, and count/page queries use the same
authorization predicate and a repeatable-read transaction. Empty lists return
zero total pages. Out-of-range pages return an empty data array with the
requested page and actual totals.

Ordinary members see only active assigned farms. Farm-update permission allows
administrative lists and details to include inactive accessible farms so they can
be reactivated. This is an explicit, permission-checked option on the existing
`FarmAccessService.farmWhere` primitive; default operational context resolution
continues to reject inactive farms. Administrative status access does not bypass
organization ownership, membership lifecycle/role checks, or assignment policy.
Farm selectors should request `isActive=true`.

Shared Zod schemas and inferred request types live in
`packages/validation/src/organization-farm.ts`; response contracts live in
`packages/types/src/organization-farm.ts`. Resource timestamps are ISO strings.
Organization profiles expose only `id`, `name`, `slug`, `isActive`,
`createdAt` and `updatedAt`. Farm responses expose only `id`,
`organizationId`, `name`, `code`, `isActive`, `createdAt` and `updatedAt`.

Invalid input returns `400 VALIDATION_ERROR` with field details. Duplicate farm
codes on create/update return `409 FARM_CODE_EXISTS`, including concurrent
creation races. Within a valid organization scope, foreign, nonexistent and
inaccessible farm details/updates return the same `404 FARM_NOT_FOUND` response.
Organization membership/permission failures remain sanitized `403 FORBIDDEN`;
authentication failures remain `401`. Resource lookups and atomic writes include
tenant/access predicates, and persistence models or database error details are
never returned directly.

The management integration suite runs under `pnpm test` against migrated
PostgreSQL using the production modules/controllers/services/guards and shared
validation. It covers CRUD/lifecycle, access-scoped pagination and counts,
cross-organization read/write attempts, role separation, inactive states,
unknown ownership fields, malformed input, duplicate races and response fields.
M1-07 requires no schema change or migration.

---

# Organization User Administration API

M1-08 follows the approved identity boundary: organization administrators manage
organization memberships and organization-specific profiles. Existing identities'
global email, password and `User.isActive` are read-only in these endpoints.
Membership `isActive` controls access to that organization only. Deactivating a
membership does not revoke the user's other memberships or global sessions;
the existing guards revalidate organization access on subsequent requests.

`OrganizationMembership.displayName` is a nullable organization-specific profile
field, so the same person can have different names in different organizations.
Existing memberships migrate with a null display name. The identity record stays
shared across organizations.

| Method | Route under `/api/organizations/:organizationId` | Permission                                                         |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| GET    | `/users`                                         | `user:read`                                                        |
| POST   | `/users`                                         | `user:create` and `membership:manage`                              |
| GET    | `/users/:userId`                                 | `user:read`                                                        |
| PATCH  | `/users/:userId/profile`                         | `user:update`                                                      |
| PATCH  | `/users/:userId/membership`                      | `membership:manage`; status changes also require `user:deactivate` |
| PUT    | `/users/:userId/farm-access`                     | `membership:manage`                                                |

User IDs in routes select a membership within the verified organization. Foreign
and nonexistent targets share `404 ORGANIZATION_USER_NOT_FOUND`. No unscoped
identity lookup is used to establish access to an administration target. The
central role policy determines permissions; MANAGER can read organization users
but cannot administer them, and STAFF cannot access the user administration API.

The list accepts the same strict `page`, `pageSize` and optional `isActive`
query contract as farm lists, with status referring to the membership. Pagination
and status validation rules are shared between the two contracts. Defaults are
page 1/size 20, maximum size 100; counts and pages use the same tenant predicate.

The M1 creation workflow is administrator bootstrap of a new identity:
`{ email, password, displayName?, role?, farmIds? }`. Email uses existing
authentication normalization; password length is 12–128 characters. Role defaults
to STAFF and farm IDs to an empty array. The existing PasswordService hashes the
password using Argon2id; the existing authentication endpoints handle subsequent
login and sessions. Identity, membership, and assignments commit atomically.
The caller must arrange credential delivery outside this API; it sends no
invitation email and returns no password or authentication tokens.

Bootstrap does not attach or change an existing identity. Uniqueness conflicts
return the generic `409 USER_CREATION_CONFLICT` without identity, organization
or membership metadata. Invalid farm selections roll back the entire operation.
Existing-user enrollment and global identity editing require a separate
consent/identity-management workflow.

Profile updates accept `{ displayName }`, trimmed to 1–120 characters or null
to clear. Membership updates accept a nonempty subset of
`{ role, isActive }`. Roles use the shared OWNER/ADMIN/MANAGER/STAFF contract.
Unknown fields, including identity credentials, ownership IDs and permission
claims, are validation errors. A globally inactive identity remains inactive
when its organization membership is reactivated.

Farm access replacement accepts `{ farmIds: [] }`, up to 1,000 unique UUIDs.
Every farm must belong to the verified organization. Foreign and nonexistent
selections share `400 INVALID_FARM_ACCESS`; a failed replacement leaves existing
grants unchanged. Existing assignments are deactivated/reactivated with stable
IDs, and missing assignments are created through bulk operations in one
transaction. An inactive farm can retain a grant but remains unavailable to
operational context resolution. Organization-wide farm access still derives
from the role policy; clearing explicit grants does not remove an administrator's
organization-wide access.

Mutations revalidate the acting membership's identity, role, active user and
active organization inside a serializable transaction. A change cannot remove
the last active user/membership whose role has `membership:manage` in that
organization. Inactive users/memberships and administrators in other
organizations do not satisfy this safeguard. `409 LAST_ADMINISTRATOR` leaves
the membership unchanged. Serialization conflicts retry at most twice, then
return `409 CONCURRENT_UPDATE`. Concurrent demotions therefore preserve
administrative access.

Shared request schemas live in `packages/validation/src/organization-member.ts`;
shared roles and response DTOs live in
`packages/types/src/organization-member.ts`. Responses include membership and
user IDs, organization ID, email, read-only `userIsActive`, display name,
membership role/status, timestamps, and farm access
`{ allFarms, farmIds }`. Password hashes, credentials, tokens, sessions and
memberships in other organizations are never selected into response DTOs.

The administration tests cover bootstrap/authentication, read/write permissions,
organization-specific profiles, shared-identity lifecycle, role/farm changes,
strict validation, foreign targets, inactive states, atomic rollback,
non-destructive grants, bounded transaction retries, and concurrent last-admin
and farm-replacement requests. The display-name migration was applied to the
existing database and verified with all migrations on a fresh temporary database.

---

# Frontend Authentication

Open `/login` to sign in through the existing NestJS authentication API. Successful
login enters `/app/dashboard`; `/app` and the legacy `/dashboard` route lead there
as well. Every protected page must call the server-only `requireUser()` helper
before loading private data, even when the containing layout checks the session.
The helper checks the existing API identity endpoint on each server render; its
React cache only deduplicates work within that render.

The browser receives a random opaque HttpOnly, SameSite=Lax, host-only cookie.
HTTPS deployments use a Secure `__Host-ancastle-session` cookie. Redis holds the
API access/refresh tokens under a SHA-256 hash of that handle, with an absolute
expiration capped at seven days. API tokens are never returned in client props,
action results, HTML, local storage or session storage. Protect Redis as a secret
store using private networking, authentication and TLS where applicable.

Configure `WEB_APP_URL` to the public web origin (HTTPS in production),
`API_INTERNAL_URL` to the server-reachable API base ending in `/api`, and
`REDIS_URL` for the web server. `WEB_SESSION_TTL_SECONDS` defaults to 604800 and
must be between 1 and 604800; keep it at or below the API refresh-session lifetime.
The web server reads only its listed settings from the root `.env` for local
development. These values are server settings, never `NEXT_PUBLIC_*` variables.
Use the same public origin when opening the app; actions verify that origin in
addition to Next.js Server Action CSRF protection.

Refreshes use a Redis lease and version-checked writes across web processes.
Logout atomically removes the browser-session mapping before requesting API
refresh-session revocation, so concurrent refresh cannot recreate it. If the API
is unavailable during logout, the removed web session stays unusable and backend
revocation is best effort. Expired/invalid sessions redirect to login; temporary
upstream failures show a safe retry state without destroying valid session data.
Authentication and organization/farm authorization remain enforced by NestJS.

Each NestJS refresh token has a random JWT ID per issuance. Rotation atomically
replaces the currently stored hash while rechecking session/user/membership
lifecycle, so concurrent requests can redeem a token only once. Consumed tokens
receive the existing safe session error. Previously issued signed tokens remain
compatible and retire on their first successful rotation.

`pnpm test` includes server action, API adapter and real-Redis session tests.
For production browser tests, start PostgreSQL/Redis, generate the Prisma client,
apply migrations, and build first:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
pnpm build
pnpm --filter @ancastle/web exec playwright install chromium
pnpm --filter @ancastle/web test:e2e
```

The browser suite starts isolated web/API test servers on ports 3310, 4310 and 4311. It uses unique database accounts and a run-specific Redis prefix, removes
its own fixtures, and disables trace/video/screenshot artifacts containing login
traffic. CI runs it against migrated PostgreSQL and Redis after the production
build. It covers login errors/loading, protected routes, reload/navigation,
parallel refresh, expired/forged/revoked sessions, inactive users, logout/replay,
upstream recovery, CSRF and mobile/desktop layouts.

---

# Application Shell and Farm Context

The protected dashboard uses `ApplicationShell` for navigation, current user and
organization identity, the user menu/logout, and organization/farm selection.
Selections are URL parameters, for example
`/app/dashboard?organization=<uuid>&farm=<uuid>`. Organization switching clears the
previous farm selection. A single accessible farm is selected automatically;
multiple farms require a choice. A user with no assigned farms can still enter
the organization workspace. Empty membership/access states have explicit messages.

`GET /api/application/context?page=1&pageSize=20` discovers only the authenticated
identity's active organizations. It returns the standard collection envelope,
with organization `id/name/slug`, organization-specific profile/role, permissions
from the central policy, and active accessible farm `id/name/code` choices.
Pagination/counts include only the caller's memberships. Unknown query fields
are validation errors; body/header ownership or role claims confer no access.
Farm choices reuse `FarmAccessService.farmWhere`, including assignment lifecycle
and organization-wide access policy. The response is `Cache-Control: no-store`.

Future protected pages should call server-only `requireApplicationContext` with
their awaited search parameters and render inside `ApplicationShell`. Use
`applicationHref` for internal links that preserve the current selection.
`useApplicationContext` exposes display context to client components inside the
shell. These values are presentation state: resource APIs must still use the
existing organization/farm guards and scoped database predicates. Farm operations
must require an actual selected farm rather than treating null as all-farm access.

The web helper selects only from a fresh server-fetched API response on each
render. It rejects malformed/duplicate parameters, unknown organizations, and
foreign/unassigned/inactive farms with one safe unavailable-workspace message.
No roles, grants or farm selections are cached in the login session or trusted
from local storage. Server-only API calls reuse M1-09 refresh coordination; tokens
remain in Redis. API outages provide retry UI without granting access.

M1-10 adds no schema migration. Unit, HTTP/PostgreSQL and production browser tests
cover scoped discovery, separate roles across organizations, automatic single-farm
selection, multiple farms, navigation/reload, client selection tampering, revoked
grants, inactive memberships/farms, empty states and responsive layouts.

---

# Organization and Farm Administration UI

Within the authenticated shell, **Organization settings** opens
`/app/settings/organization` and **Farms** opens `/app/farms`. These are
organization-level management routes; their navigation carries the selected
organization. Dashboard/farm-operation selection remains separate. Farm details
use `/app/farms/<uuid>` and creation uses `/app/farms/new`.

Organization settings shows the current profile, slug and lifecycle information.
Only organization-update permission exposes the name-edit form. Farms uses the
existing access-scoped paginated API, with active/inactive filters and safe empty
states. Create/edit/lifecycle controls appear only with the corresponding fresh
permissions. Other members can view their accessible records without edit controls.
Deactivation/reactivation uses the existing non-destructive PATCH API.

Server Actions independently recheck origin, authenticated organization membership
and current permissions before calling the guarded API. Form IDs only select
resources to verify. Actions whitelist supported fields, validate shared Zod
contracts, reject duplicate/malformed selectors, and never forward ownership or
role claims as authorization. API calls remain server-side and reuse Redis-backed
refresh coordination. Shared response schemas strip unexpected fields. Known
business codes map to fixed UI messages; raw upstream errors and internal details
are never reflected. Successful mutations refresh the shell and affected views.

The browser suite covers organization updates, complete farm lifecycle, validation
and duplicate codes, read-only access, cross-organization read/write attempts,
tampered IDs, stale permissions, pagination/filtering, outages/retry/pending states,
and mobile/desktop layouts. Existing API security tests remain unchanged.

---

# Organization User and Access Administration UI

**Organization users** opens `/app/users`; create and detail routes are
`/app/users/new` and `/app/users/<uuid>`, with the selected organization in the URL.
Lists paginate and filter membership status through the existing M1-08 API.
Read permission controls navigation and data access. Profile, role, farm-assignment
and lifecycle forms each require their corresponding fresh permissions.

The UI follows the approved membership-only boundary. Existing global email and
account status are read-only. Profile editing changes only the organization-specific
display name, including clearing it. Membership deactivation affects only that
organization; reactivating it does not activate a globally inactive identity.

Creation uses the existing new-identity bootstrap API, with email, an initial
12–128 character password, organization display name, role and explicit farm grants.
The password input is masked and never populated from persisted identity data.
Credentials never enter action results or view models. Credential delivery remains
outside this application workflow; existing identities require the separate
identity-enrollment workflow described in the API documentation.

Farm assignments support multiple, one or zero explicit grants and include inactive
farms with a visible status. Inactive farms remain unavailable for operations.
Organization-wide farm access derives from the existing permission policy, so
explicit grants do not restrict a role that has all-farm access. Last-administrator
and concurrency safeguards remain enforced by the backend, with safe UI messages.

Server Actions revalidate origin, identity, selected organization and every required
permission. Client user/farm IDs select targets for the guarded API to verify;
profile/role/status/assignment writes forward only their supported contract fields.
Tests cover bootstrap/login, credential non-disclosure, shared-identity profile
isolation, grant replacement, membership lifecycle, read-only roles, foreign target
and grant injection, stale/inactive access, last-administrator errors, validation,
pagination, filtering and responsive layouts. No persistence changes are required.

---

# M1 Milestone Security Integration Suite

`apps/api/src/modules/security/m1-security.integration.spec.ts` composes the real
NestJS authentication, authorization, organization, farm, user and access-discovery
modules through HTTP against PostgreSQL. It uses real password verification and
login-issued tokens, unique tenant/user fixtures, and cleanup limited to those
fixtures. An operational probe exists only in the test module to exercise the
production farm guard/context/scoping primitives; it adds no production endpoint.

Coverage includes the login-to-administration workflow, unauthenticated endpoints,
malformed/expired/wrong-type/wrong-signature tokens, sanitized login failures,
already-issued tokens with inactive lifecycle states, organization-specific roles,
cross-organization reads/writes and farm grants, payload/header spoofing, assigned
operational farm selection, record isolation by both ownership columns, safe DTOs,
hashed refresh persistence, same-second rotation/replay/logout and concurrent
single-use refresh redemption.

Run migrations against the intended test database before the suite:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
pnpm --filter @ancastle/api exec vitest run src/modules/security/m1-security.integration.spec.ts
```

Root `pnpm test` and CI include this suite automatically. Run the root API tests
and browser tests sequentially, as CI does, when they share PostgreSQL; overlapping
independent suites can exhaust bounded serializable-transaction retries.

Negative controls were executed with the production code restored afterward:
removing the organization predicate from `OrganizationContext.scope` made the
foreign-user read return 200 instead of 404, and removing the farm predicate from
`FarmContext.scope` made an adjacent farm's record return 200 instead of 404.
The corresponding milestone assertions failed for those exact leaks and all
16 scenarios passed with the original constraints restored. Production context
and guard implementations are unchanged by this card.

The suite also exposed same-second and concurrent refresh-rotation regressions.
Those were corrected separately in M1-03 PR #26, preserving the existing JWT and
hashed server-session architecture; their milestone assertions remain intact.

---

# M2 Customer and Supplier Master Data

M2 introduces Customers and Suppliers as organization-owned master data. These
records belong to an Organization rather than an individual Farm so that one
organization can maintain a single Customer and Supplier directory across all of
its permitted farms.

Customer and Supplier ownership is established exclusively by the authenticated
organization context. Clients cannot select or change `organizationId`, generated
record codes, lifecycle state, IDs or timestamps through create/update payloads.
The API derives organization ownership from the guarded route context and applies
the organization predicate to reads, writes, lifecycle operations and collection
queries.

Customer and Supplier codes are generated independently within each organization.
The same generated code may therefore exist in different organizations without
creating a cross-tenant conflict. API response DTOs intentionally omit internal
organization ownership fields.

## Organization-Level Master Data and Farm-Scoped Operations

Customers and Suppliers are organization-level master data. They are deliberately
not duplicated per Farm and do not contain a `farmId`. An organization with
multiple farms therefore uses the same Customer and Supplier records throughout
its workspace.

This boundary is distinct from operational and transactional records. Future
inventory, poultry, order, fulfilment and similar farm operations must retain
their appropriate farm scope while referencing organization-owned master data
where required. A farm selection must never redefine Customer or Supplier
ownership.

The application shell may carry both organization and farm selections for user
context, but Customer and Supplier authorization continues to derive from the
verified organization. Farm UI state is not an ownership or authorization claim.

## Customer and Supplier Permissions

The central role policy defines the M2 permissions:

| Role    | Read | Create | Update | Deactivate / Reactivate |
| ------- | ---- | ------ | ------ | ----------------------- |
| OWNER   | Yes  | Yes    | Yes    | Yes                     |
| ADMIN   | Yes  | Yes    | Yes    | Yes                     |
| MANAGER | Yes  | Yes    | Yes    | No                      |
| STAFF   | Yes  | No     | No     | No                      |

Customer permissions are `customer:read`, `customer:create`, `customer:update`
and `customer:deactivate`. Supplier permissions use the equivalent
`supplier:read`, `supplier:create`, `supplier:update` and
`supplier:deactivate` permissions.

The web application uses fresh application context to determine which controls
are displayed, while server actions and NestJS guards independently revalidate
authorization before performing operations. UI visibility is never treated as
the security boundary.

## Customer API

Customer routes are scoped beneath the verified organization:

| Method | Route under `/api/organizations/:organizationId` | Purpose                      |
| ------ | ------------------------------------------------ | ---------------------------- |
| GET    | `/customers`                                     | List/search/filter customers |
| POST   | `/customers`                                     | Create a customer            |
| GET    | `/customers/:customerId`                         | Read a customer              |
| PATCH  | `/customers/:customerId`                         | Update a customer            |
| POST   | `/customers/:customerId/deactivate`              | Deactivate a customer        |
| POST   | `/customers/:customerId/reactivate`              | Reactivate a customer        |

Customer records support `INDIVIDUAL` and `BUSINESS` types together with name,
contact person, phone, email, address and notes. Codes are server-generated and
cannot be supplied or changed by clients.

## Supplier API

Supplier routes use the same organization-owned lifecycle:

| Method | Route under `/api/organizations/:organizationId` | Purpose                      |
| ------ | ------------------------------------------------ | ---------------------------- |
| GET    | `/suppliers`                                     | List/search/filter suppliers |
| POST   | `/suppliers`                                     | Create a supplier            |
| GET    | `/suppliers/:supplierId`                         | Read a supplier              |
| PATCH  | `/suppliers/:supplierId`                         | Update a supplier            |
| POST   | `/suppliers/:supplierId/deactivate`              | Deactivate a supplier        |
| POST   | `/suppliers/:supplierId/reactivate`              | Reactivate a supplier        |

Supplier records contain name, contact person, phone, email, address and notes.
Supplier codes are generated by the server and are immutable through the public
create/update contracts.

## Search, Filtering and Pagination

Customer and Supplier collection endpoints share the master-data query contract:

- `page` defaults to 1 and must be at least 1.
- `pageSize` defaults to 20, must be at least 1 and is capped at 100.
- `search` is optional and limited to 120 characters.
- `isActive` optionally filters active or inactive records.
- Unknown query fields are rejected.

Search executes on the server within the verified organization predicate.
Customer search includes code, name, contact person, email and phone. Supplier
search uses the equivalent Supplier fields.

Results use deterministic code/ID ordering and the standard pagination metadata.
The data query and total count use the same organization and filter predicates,
preventing pagination metadata from leaking records belonging to another tenant.

## Lifecycle and Tenant Isolation

Deactivation is non-destructive. Inactive Customers and Suppliers remain stored
and can be viewed through the inactive filter and reactivated by an authorized
user. Lifecycle operations require their dedicated deactivate permission.

Foreign and nonexistent detail/update/lifecycle targets use the same safe
not-found behavior so callers cannot use response differences to determine
whether another organization's record exists.

Organization ownership supplied in request payloads is rejected rather than
trusted. Cross-organization reads, writes, lifecycle operations and search
results remain constrained by the verified organization. Existing M1 guards
continue to reject unauthenticated requests and inactive users, memberships and
organizations.

## M2 Web Workflow

Authorized users manage Customers through `/app/customers` and Suppliers through
`/app/suppliers`. Creation and detail/edit workflows remain inside the protected
application shell and preserve the selected organization context.

The reusable master-data list provides server-backed search, active/inactive
filtering, pagination, loading/error/empty states and responsive presentation.
Initial empty collections are distinguished from filtered searches with no
matches.

Lifecycle controls are shown only when the current role has the required
permission. Server Actions revalidate origin, authenticated organization context
and permissions before calling the guarded API. Supported fields are explicitly
whitelisted and validated through the shared contracts.

## M2 Validation

M2 validation covers the complete persistence-to-browser workflow:

1. Authenticate and enter an authorized organization workspace.
2. Create, view and update a Customer.
3. Search, filter and paginate Customer records.
4. Deactivate and reactivate a Customer.
5. Create, view and update a Supplier.
6. Search, filter and paginate Supplier records.
7. Deactivate and reactivate a Supplier.
8. Verify read-only and lifecycle permission restrictions.
9. Verify foreign organization records cannot be read, changed or discovered
   through collection searches.
10. Verify Customer and Supplier ownership remains organization-level while the
    organization can contain multiple Farms.

Customer and Supplier HTTP/PostgreSQL integration suites cover CRUD, lifecycle,
permissions, strict validation, ownership spoofing, organization isolation,
search/filter/pagination and safe response DTOs. M2-11 includes explicit
regressions proving an exact search for a foreign organization's Customer or
Supplier returns no records.

Existing M1 integration coverage remains responsible for authentication,
inactive user/membership/organization handling, organization/farm context and
multiple-farm access infrastructure. M2 builds on those boundaries rather than
duplicating them.

The production browser suite covers Customer and Supplier management through the
authenticated application shell, including lifecycle operations, Customer query
handling and responsive application behavior.

## M2 Setup and Verification

For a fresh environment, follow the Clean Local Setup Validation instructions
above, then generate the Prisma client and apply all committed migrations:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
```

## Inventory

Inventory uses a ledger-oriented model with a deliberate separation between
organization-owned item definitions and farm-scoped physical stock.

```text
Organization
    │
    └── Inventory Item
            │
            ├── Farm A → Inventory Movements → Derived Stock
            │
            └── Farm B → Inventory Movements → Derived Stock
```

An `InventoryItem` defines reusable organization-level information such as the
item code, name, unit, category and low-stock threshold. It does not store the
authoritative quantity on hand and does not belong to an individual Farm.

Physical stock is farm-scoped. The same organization-owned item can therefore
exist operationally across multiple permitted farms while each farm maintains
an independent stock balance.

Stock-on-hand is derived from the immutable inventory movement ledger:

```text
stockOnHand = SUM(movement.quantity)
```

Positive movement quantities add stock and negative quantities remove stock.
A zero movement is invalid.

Posted movements are historical business events and are not edited or deleted.
If an inventory error must be corrected, the correction is represented by a
new compensating `ADJUSTMENT` movement rather than modifying the original
ledger entry.

The service prevents a movement from producing a negative stock balance.
Concurrency-sensitive movement posting is serialized for the affected stock
position so concurrent requests cannot independently pass the stock check and
overdraw the same inventory.

Low-stock state is calculated from the derived farm balance and the
organization-owned item's configured low-stock threshold. The balance itself
is never maintained as a client-calculated or directly editable source of
truth.

---

# M3 Inventory Foundation

M3 establishes the inventory foundation for Ancastle Farms using
organization-owned inventory definitions, farm-scoped physical stock and an
immutable movement ledger.

The inventory architecture intentionally separates item identity from physical
stock. An Inventory Item belongs to an Organization and may be used by multiple
Farms within that organization. Each Farm's stock balance remains independent
and is derived exclusively from movements posted for that Farm.

## Inventory Ownership Model

Inventory Items are organization-level master data.

They contain:

- Server-generated item code
- Name
- Description
- Unit
- Category
- Low-stock threshold
- Lifecycle state

They do not contain a `farmId` or an authoritative quantity-on-hand field.

Physical inventory is farm-scoped through Inventory Movements. Every movement
belongs to both the verified Organization and selected Farm and references an
Inventory Item belonging to that Organization.

This allows one organization-owned item definition to be used across multiple
farms without duplicating the item while preventing balances from leaking
between farms.

## Inventory Movement Ledger

Inventory Movements are immutable ledger entries.

A movement records:

- Farm
- Inventory Item
- Acting user
- Signed quantity
- Reason
- Occurred date
- Optional note
- Optional reference
- Creation timestamp

Supported reasons are:

- `RECEIPT`
- `ISSUE`
- `ADJUSTMENT`

Movement direction is determined by the signed quantity rather than the reason:

```text
quantity > 0  → stock enters the farm
quantity < 0  → stock leaves the farm
quantity = 0  → invalid
```

The reason describes why the movement occurred.

Posted movements are not updated or deleted through the public API. Corrections
are made by posting a compensating `ADJUSTMENT` movement, preserving the
original event and the audit trail.

## Derived Stock-on-Hand

Stock-on-hand is not stored as an editable authoritative field.

For an Inventory Item within a Farm:

```text
stockOnHand = SUM(inventoryMovement.quantity)
```

The API derives the current balance from the movement ledger.

Outbound movements that would make the resulting balance negative are rejected.
Movement posting protects the affected stock position against concurrent
updates so simultaneous outbound requests cannot independently overdraw the
same inventory.

The frontend displays the server-derived balance and never calculates an
authoritative stock balance independently.

## Low-Stock Status

An Inventory Item may define an organization-level low-stock threshold.

Stock status is derived by the backend from the Farm's current stock balance
and the Inventory Item's configured threshold:

| Status         | Condition                                                               |
| -------------- | ----------------------------------------------------------------------- |
| `OUT_OF_STOCK` | Stock-on-hand equals zero                                               |
| `LOW`          | A threshold is configured and stock-on-hand is less than or equal to it |
| `HEALTHY`      | A threshold is configured and stock-on-hand is greater than it          |
| `UNMONITORED`  | No threshold is configured and stock-on-hand is greater than zero       |

`OUT_OF_STOCK` takes precedence when the balance is zero, including when no
low-stock threshold is configured.

Stock status is derived rather than persisted as a second source of truth.

Because the threshold belongs to the Inventory Item while the balance belongs
to the Farm's movement ledger, the same item may have a different stock status
at different Farms.

## Inventory Permissions

The central authorization policy defines four inventory permissions:

| Permission                   | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `inventory:read`             | View inventory items, farm stock and movement history |
| `inventory:item-manage`      | Create and update organization-owned Inventory Items  |
| `inventory:movement-post`    | Post inventory movements                              |
| `inventory:lifecycle-manage` | Deactivate and reactivate Inventory Items             |

OWNER, ADMIN and MANAGER roles receive all four permissions.

STAFF can read inventory and post permitted movements but cannot manage item
definitions or item lifecycle.

Farm authorization remains a separate boundary. Having an inventory permission
does not grant access to an otherwise inaccessible Farm.

The frontend hides controls the current application context does not permit,
but NestJS guards and verified organization/farm context remain authoritative.

## Inventory Item API

Inventory Item management is organization-scoped:

| Method | Route under `/api/organizations/:organizationId` | Purpose                      |
| ------ | ------------------------------------------------ | ---------------------------- |
| GET    | `/inventory-items`                               | List Inventory Items         |
| POST   | `/inventory-items`                               | Create an Inventory Item     |
| GET    | `/inventory-items/:inventoryItemId`              | Read an Inventory Item       |
| PATCH  | `/inventory-items/:inventoryItemId`              | Update an Inventory Item     |
| POST   | `/inventory-items/:inventoryItemId/deactivate`   | Deactivate an Inventory Item |
| POST   | `/inventory-items/:inventoryItemId/reactivate`   | Reactivate an Inventory Item |

Organization ownership, generated code and lifecycle state cannot be supplied
or replaced through normal create/update payloads.

## Farm Inventory API

Operational inventory routes require both verified organization and farm
context:

| Method | Route under `/api/organizations/:organizationId/farms/:farmId/inventory` | Purpose                    |
| ------ | ------------------------------------------------------------------------ | -------------------------- |
| GET    | `/`                                                                      | View derived Farm stock    |
| GET    | `/movements`                                                             | View movement history      |
| POST   | `/movements`                                                             | Post an Inventory Movement |

Movement history supports pagination and filtering while remaining constrained
to the verified Organization and Farm.

There are intentionally no public PATCH or DELETE movement endpoints.

## Inventory Web Workflow

Inventory management is available through the authenticated application shell.

Organization-level Inventory Item management allows authorized users to create,
view, update, deactivate and reactivate reusable item definitions.

The operational stock view requires a selected accessible Farm. Switching the
Farm through the existing application context reloads stock and movement data
for that verified Farm rather than treating the UI selection as authorization.

The Farm inventory view shows server-derived stock, item metadata, lifecycle
state and low-stock state. Authorized users can post receipts, issues and
adjustments and review immutable movement history.

Movement history displays the movement reason, signed quantity, occurrence
date, actor information and available notes/reference information.

The movement workflow does not expose edit or delete controls for posted
history. Corrections are represented as additional adjustment entries.

## Tenant and Farm Isolation

Inventory Item definitions are constrained by verified organization ownership.

Farm stock and movements are constrained by both verified organization and
verified farm context.

An Inventory Item belonging to one Organization cannot be posted into another
Organization's Farm.

Within one Organization, the same Inventory Item can be used by multiple
permitted Farms while each Farm's movement ledger and derived balance remain
independent.

Existing M1 organization and farm authorization infrastructure remains
responsible for establishing trusted request context. Inventory services build
on those boundaries rather than trusting organization, farm, role or permission
claims supplied by clients.

## M3 Validation

M3 validation covers the complete inventory workflow:

1. Authenticate and enter an authorized organization workspace.
2. Create and manage an organization-owned Inventory Item.
3. Verify Inventory Item lifecycle behavior.
4. Select an assigned Farm.
5. View that Farm's server-derived inventory balance.
6. Post a positive receipt movement and verify the balance increases.
7. Post an outbound issue movement and verify the balance decreases.
8. Verify an outbound movement cannot produce negative stock.
9. Post an adjustment and verify the ledger-derived balance.
10. Review immutable movement history.
11. Verify corrections use compensating movements rather than editing history.
12. Verify low-stock and out-of-stock state from the derived Farm balance.
13. Switch between permitted Farms and verify their balances remain independent.
14. Verify an unassigned or foreign Farm cannot be used for operational inventory.
15. Verify another Organization's Inventory Item cannot be discovered or posted
    into the selected Farm.
16. Verify inventory controls respect the central permission policy.
17. Verify the workflow remains usable on mobile and desktop layouts.

Existing M1 coverage remains responsible for the underlying authentication,
organization membership and farm-assignment security boundaries. M3 inventory
coverage validates the inventory-specific ledger, stock, tenant and farm
invariants without duplicating those established tests.

## M3 Setup and Verification

For a fresh environment, install dependencies, configure the environment and
start PostgreSQL and Redis as described in the local development instructions.

Generate the Prisma client and apply all committed migrations:

```bash
pnpm --filter @ancastle/api db:generate
pnpm --filter @ancastle/api db:migrate:deploy
```

Run the repository quality gates:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All checks must pass before M3 is considered complete.
