## Database

Ancastle Farms uses PostgreSQL with Prisma.

### Start PostgreSQL

```bash
docker compose up -d postgres
```
## Redis

### Start Redis:

```bash
docker compose up -d redis
```

## Local Development Infrastructure

Ancastle Farms uses Docker Compose for local infrastructure dependencies.

The Next.js web application and NestJS API run directly through Node.js/pnpm during development, while PostgreSQL and Redis run in Docker.

### Prerequisites

- Node.js
- pnpm
- Docker Desktop

### Environment Setup

Copy the example environment file:

```bash
cp .env.example .env