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

Turborepo starts the applicable workspace development processes.

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

Running applications individually can be useful when working exclusively on the frontend or backend.

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
