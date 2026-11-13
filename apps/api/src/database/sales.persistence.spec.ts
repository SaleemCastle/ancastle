import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, cp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

const exec = promisify(execFile);
const migrationName = '20261113160000_sales_persistence';
const at = new Date('2026-11-13T12:00:00.000Z');
const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

describe('Sales persistence and additive migration', () => {
  const baseUrl = process.env.DATABASE_URL!;
  const admin = client(baseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const databaseNames = [
    `ancastle_m503_fresh_${suffix}`,
    `ancastle_m503_upgrade_${suffix}`,
  ];
  const databaseUrl = (name: string) => {
    const url = new URL(baseUrl);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const fresh = client(databaseUrl(databaseNames[0]!));
  const upgrade = client(databaseUrl(databaseNames[1]!));
  const createdDatabases: string[] = [];
  let scratch: string;
  let freshConfig: string;
  let legacy: Awaited<ReturnType<typeof seedLegacy>>;

  async function deploy(name: string, includeSales: boolean) {
    const directory = join(scratch, `${name}-${includeSales ? 'sales' : 'm4'}`);
    await mkdir(join(directory, 'migrations'), { recursive: true });
    await cp(resolve('prisma/schema.prisma'), join(directory, 'schema.prisma'));
    for (const entry of await readdir(resolve('prisma/migrations'))) {
      if (
        entry !== 'migration_lock.toml' &&
        (entry > migrationName || (entry === migrationName && !includeSales))
      )
        continue;
      await cp(
        resolve('prisma/migrations', entry),
        join(directory, 'migrations', entry),
        {
          recursive: true,
        },
      );
    }
    const config = join(directory, 'prisma.config.mjs');
    await writeFile(
      config,
      `import { defineConfig } from 'prisma/config';
export default defineConfig({schema: ${JSON.stringify(join(directory, 'schema.prisma'))},
migrations: {path: ${JSON.stringify(join(directory, 'migrations'))}},
datasource: {url: process.env.DATABASE_URL}});`,
    );
    // Do not log the environment or connection URL, including on CLI failure.
    try {
      await exec(
        process.execPath,
        [
          resolve('node_modules/prisma/build/index.js'),
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        {
          env: { ...process.env, DATABASE_URL: databaseUrl(name) },
          timeout: 60_000,
        },
      );
    } catch {
      throw new Error(
        `Migration deployment failed for disposable ${includeSales ? 'M5' : 'M4'} database`,
      );
    }
    return config;
  }

  beforeAll(async () => {
    // Scratch stays below node_modules so the temporary config resolves the pinned Prisma package.
    const cacheRoot = resolve('node_modules/.cache');
    await mkdir(cacheRoot, { recursive: true });
    scratch = await mkdtemp(join(cacheRoot, 'ancastle-m503-'));
    for (const name of databaseNames) {
      // Names contain only this fixed prefix and a generated hex UUID, never external input.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      createdDatabases.push(name);
    }
    freshConfig = await deploy(databaseNames[0]!, true);
    await deploy(databaseNames[1]!, false);
    legacy = await seedLegacy(upgrade);
    await deploy(databaseNames[1]!, true);
  }, 120_000);

  afterAll(async () => {
    await fresh.$disconnect();
    await upgrade.$disconnect();
    for (const name of createdDatabases) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.$disconnect();
    // mkdtemp's absolute path is constrained to this dedicated cache prefix.
    if (
      scratch?.startsWith(
        join(resolve('node_modules/.cache'), 'ancastle-m503-'),
      )
    ) {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  async function seedLegacy(db: PrismaClient) {
    const organizationId = randomUUID();
    const actorUserId = randomUUID();
    await db.organization.create({
      data: { id: organizationId, name: 'Legacy M4', slug: organizationId },
    });
    await db.user.create({
      data: {
        id: actorUserId,
        email: `${actorUserId}@example.com`,
        passwordHash: 'unused',
      },
    });
    await db.organizationMembership.create({
      data: { organizationId, userId: actorUserId },
    });
    const farm = await db.farm.create({
      data: { organizationId, code: 'M4', name: 'M4' },
    });
    const customer = await db.customer.create({
      data: {
        organizationId,
        code: 'CUS-1',
        type: 'INDIVIDUAL',
        name: 'Legacy',
      },
    });
    const item = await db.inventoryItem.create({
      data: {
        organizationId,
        code: 'FEED-1',
        name: 'Feed',
        unit: 'KG',
        category: 'FEED',
      },
    });
    const flock = await db.flock.create({
      data: {
        organizationId,
        farmId: farm.id,
        code: 'FLK-1',
        name: 'Legacy',
        startingBirdCount: 100,
        placementDate: at,
      },
    });
    const mortality = await db.mortalityEvent.create({
      data: {
        organizationId,
        farmId: farm.id,
        flockId: flock.id,
        actorUserId,
        deathCount: 3,
        occurredAt: at,
      },
    });
    const movement = await db.inventoryMovement.create({
      data: {
        organizationId,
        farmId: farm.id,
        inventoryItemId: item.id,
        actorUserId,
        quantity: '-1.125',
        reason: 'ISSUE',
        occurredAt: at,
      },
    });
    const usage = await db.feedUsage.create({
      data: {
        organizationId,
        farmId: farm.id,
        flockId: flock.id,
        inventoryItemId: item.id,
        actorUserId,
        inventoryMovementId: movement.id,
        quantity: '1.125',
        occurredAt: at,
      },
    });
    return {
      organizationId,
      actorUserId,
      farm,
      customer,
      item,
      flock,
      mortality,
      movement,
      usage,
    };
  }

  async function seed(tx: Prisma.TransactionClient) {
    const org = await tx.organization.create({
      data: { name: 'Sales', slug: randomUUID() },
    });
    const foreignOrg = await tx.organization.create({
      data: { name: 'Foreign', slug: randomUUID() },
    });
    const actor = await tx.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
    });
    await tx.organizationMembership.create({
      data: { organizationId: org.id, userId: actor.id },
    });
    const farm = await tx.farm.create({
      data: { organizationId: org.id, code: 'NORTH', name: 'North' },
    });
    const otherFarm = await tx.farm.create({
      data: { organizationId: org.id, code: 'SOUTH', name: 'South' },
    });
    const foreignFarm = await tx.farm.create({
      data: { organizationId: foreignOrg.id, code: 'NORTH', name: 'Foreign' },
    });
    const customer = await tx.customer.create({
      data: {
        organizationId: org.id,
        code: 'CUS-1',
        type: 'INDIVIDUAL',
        name: 'Customer',
      },
    });
    const foreignCustomer = await tx.customer.create({
      data: {
        organizationId: foreignOrg.id,
        code: 'CUS-1',
        type: 'INDIVIDUAL',
        name: 'Foreign',
      },
    });
    const item = await tx.inventoryItem.create({
      data: {
        organizationId: org.id,
        code: 'INV-1',
        name: 'Produce',
        category: 'PRODUCE',
        unit: 'KG',
      },
    });
    const foreignItem = await tx.inventoryItem.create({
      data: {
        organizationId: foreignOrg.id,
        code: 'INV-1',
        name: 'Foreign',
        category: 'PRODUCE',
        unit: 'KG',
      },
    });
    const flockData = {
      name: 'Birds',
      startingBirdCount: 100,
      placementDate: at,
    };
    const flock = await tx.flock.create({
      data: {
        ...flockData,
        organizationId: org.id,
        farmId: farm.id,
        code: 'FLK-1',
      },
    });
    const otherFlock = await tx.flock.create({
      data: {
        ...flockData,
        organizationId: org.id,
        farmId: otherFarm.id,
        code: 'FLK-2',
      },
    });
    const product = await tx.salesProduct.create({
      data: {
        organizationId: org.id,
        code: 'PRD-1',
        name: 'Birds',
        kind: 'POULTRY',
        unit: 'EACH',
      },
    });
    const produce = await tx.salesProduct.create({
      data: {
        organizationId: org.id,
        code: 'PRD-2',
        name: 'Produce',
        kind: 'PRODUCE',
        unit: 'KG',
        inventoryItemId: item.id,
      },
    });
    const source = await tx.poultryProductSource.create({
      data: {
        organizationId: org.id,
        farmId: farm.id,
        productId: product.id,
        flockId: flock.id,
        actorUserId: actor.id,
      },
    });
    const order = await tx.order.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        code: 'ORD-1',
        actorUserId: actor.id,
        customerCode: customer.code,
        customerName: customer.name,
        saleType: 'CASH',
      },
    });
    const line = await tx.orderLine.create({
      data: {
        organizationId: org.id,
        orderId: order.id,
        lineNumber: 1,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        kind: 'POULTRY',
        unit: 'EACH',
        orderedQuantity: '10',
        unitPrice: '123.4567',
      },
    });
    return {
      org,
      foreignOrg,
      actor,
      farm,
      otherFarm,
      foreignFarm,
      customer,
      foreignCustomer,
      item,
      foreignItem,
      flock,
      otherFlock,
      product,
      produce,
      source,
      order,
      line,
    };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  async function withFixture(
    work: (tx: Prisma.TransactionClient, f: Fixture) => Promise<void>,
  ) {
    const rollback = new Error('Rollback sales fixtures');
    try {
      await fresh.$transaction(
        async (tx) => {
          const f = await seed(tx);
          await work(tx, f);
          // Exercise deferred commit checks even though immutable fixtures are rolled back.
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          throw rollback;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  async function rejects(
    tx: Prisma.TransactionClient,
    work: () => Promise<unknown>,
  ) {
    await tx.$executeRaw`SAVEPOINT sales_rejection`;
    try {
      await expect(work()).rejects.toThrow();
    } finally {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT sales_rejection`;
      await tx.$executeRaw`RELEASE SAVEPOINT sales_rejection`;
    }
  }

  async function confirm(tx: Prisma.TransactionClient, f: Fixture) {
    return tx.order.update({
      where: { id: f.order.id },
      data: { commercialState: 'CONFIRMED', version: { increment: 1 } },
    });
  }

  async function batch(
    tx: Prisma.TransactionClient,
    f: Fixture,
    options: {
      produce?: boolean;
      key?: string;
      quantity?: string;
      reverse?: {
        event: { id: string };
        allocation: { id: string };
        depletion: { id: string } | null;
      };
      omitDepletion?: boolean;
      omitReceipt?: boolean;
    } = {},
  ) {
    const quantity = options.quantity ?? (options.produce ? '1.125' : '3');
    const order = await tx.order.update({
      where: { id: f.order.id },
      data: { version: { increment: 1 } },
    });
    const event = await tx.fulfilment.create({
      data: {
        organizationId: f.org.id,
        farmId: f.farm.id,
        orderId: f.order.id,
        code: randomUUID(),
        actorUserId: f.actor.id,
        occurredAt: at,
        kind: options.reverse ? 'REVERSAL' : 'POSTING',
        ...(options.reverse
          ? {
              reversesFulfilmentId: options.reverse.event.id,
              reason: 'Posting error',
              postingErrorConfirmed: true,
            }
          : {}),
      },
    });
    const movement = options.produce
      ? await tx.inventoryMovement.create({
          data: {
            organizationId: f.org.id,
            farmId: f.farm.id,
            inventoryItemId: f.item.id,
            actorUserId: f.actor.id,
            quantity: options.reverse ? quantity : `-${quantity}`,
            reason: options.reverse ? 'ADJUSTMENT' : 'ISSUE',
            occurredAt: at,
          },
        })
      : null;
    const allocation = await tx.fulfilmentLine.create({
      data: {
        organizationId: f.org.id,
        farmId: f.farm.id,
        orderId: f.order.id,
        fulfilmentId: event.id,
        orderLineId: f.line.id,
        quantity,
        occurredAt: at,
        sourceCode: options.produce ? f.item.code : f.flock.code,
        kind: options.produce ? 'PRODUCE' : 'POULTRY',
        unit: options.produce ? 'KG' : 'EACH',
        ...(options.produce
          ? { inventoryItemId: f.item.id, inventoryMovementId: movement!.id }
          : { flockId: f.flock.id }),
        reversesLineId: options.reverse?.allocation.id,
      },
    });
    const depletion =
      !options.produce && !options.omitDepletion
        ? await tx.flockSaleDepletion.create({
            data: {
              organizationId: f.org.id,
              farmId: f.farm.id,
              flockId: f.flock.id,
              fulfilmentLineId: allocation.id,
              birdCount: Number(quantity),
              actorUserId: f.actor.id,
              occurredAt: at,
              reversesDepletionId: options.reverse?.depletion?.id,
            },
          })
        : null;
    const receipt = !options.omitReceipt
      ? await tx.fulfilmentCommand.create({
          data: {
            organizationId: f.org.id,
            farmId: f.farm.id,
            orderId: f.order.id,
            fulfilmentId: event.id,
            operation: options.reverse ? 'REVERSE' : 'POST',
            key: options.key ?? randomUUID(),
            requestHash: 'a'.repeat(64),
            hashVersion: 1,
            actorUserId: f.actor.id,
            orderVersion: order.version,
          },
        })
      : null;
    return { event, allocation, depletion, receipt, movement };
  }

  it('deploys the full migration chain to a fresh disposable database', async () => {
    const migrations = await fresh.$queryRaw<
      { migration_name: string; finished_at: Date | null }[]
    >`
      SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ${migrationName}`;
    expect(migrations).toHaveLength(1);
    expect(migrations[0]!.finished_at).toBeInstanceOf(Date);
    expect(await fresh.order.count()).toBe(0);
    expect(await fresh.fulfilmentCommand.count()).toBe(0);
  });

  it('keeps the deployed Prisma structure in sync with the schema', async () => {
    const result = await exec(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        resolve('prisma/schema.prisma'),
        '--exit-code',
        '--config',
        freshConfig,
      ],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl(databaseNames[0]!) },
        timeout: 30_000,
      },
    );
    expect(result.stdout).toContain('No difference detected');
  }, 45_000);

  it('upgrades populated M4 without rewriting customers, stock, mortality, feed or flock baselines', async () => {
    expect(
      await upgrade.customer.findUnique({ where: { id: legacy.customer.id } }),
    ).toEqual(legacy.customer);
    expect(
      await upgrade.inventoryMovement.findUnique({
        where: { id: legacy.movement.id },
      }),
    ).toEqual(legacy.movement);
    expect(
      await upgrade.feedUsage.findUnique({ where: { id: legacy.usage.id } }),
    ).toEqual(legacy.usage);
    expect(
      await upgrade.mortalityEvent.findUnique({
        where: { id: legacy.mortality.id },
      }),
    ).toEqual(legacy.mortality);
    expect(
      await upgrade.flock.findUnique({ where: { id: legacy.flock.id } }),
    ).toEqual(legacy.flock);
    // Existing M4 consumption remains writable after the new sales-only guards are installed.
    await upgrade.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({
        data: {
          organizationId: legacy.organizationId,
          farmId: legacy.farm.id,
          inventoryItemId: legacy.item.id,
          actorUserId: legacy.actorUserId,
          quantity: '-0.125',
          reason: 'ISSUE',
          occurredAt: at,
        },
      });
      await tx.feedUsage.create({
        data: {
          organizationId: legacy.organizationId,
          farmId: legacy.farm.id,
          flockId: legacy.flock.id,
          inventoryItemId: legacy.item.id,
          actorUserId: legacy.actorUserId,
          inventoryMovementId: movement.id,
          quantity: '0.125',
          occurredAt: at,
        },
      });
    });
  });

  it('enforces tenant-safe customer/catalog links and poultry-only eligibility', async () => {
    await withFixture(async (tx, f) => {
      await rejects(tx, () =>
        tx.order.create({
          data: {
            organizationId: f.org.id,
            customerId: f.foreignCustomer.id,
            code: 'BAD',
            actorUserId: f.actor.id,
            customerCode: 'X',
            customerName: 'X',
            saleType: 'CASH',
          },
        }),
      );
      for (const data of [
        {
          kind: 'PRODUCE' as const,
          unit: 'KG' as const,
          inventoryItemId: f.foreignItem.id,
        },
        {
          kind: 'PRODUCE' as const,
          unit: 'EACH' as const,
          inventoryItemId: f.item.id,
        },
        {
          kind: 'POULTRY' as const,
          unit: 'EACH' as const,
          inventoryItemId: f.item.id,
        },
      ])
        await rejects(tx, () =>
          tx.salesProduct.create({
            data: {
              ...data,
              organizationId: f.org.id,
              code: 'BAD',
              name: 'Bad',
            },
          }),
        );
      for (const change of [
        { productId: f.produce.id },
        { flockId: f.otherFlock.id },
        { farmId: f.foreignFarm.id },
        { actorUserId: randomUUID() },
      ])
        await rejects(tx, () =>
          tx.poultryProductSource.create({
            data: {
              organizationId: f.org.id,
              farmId: f.farm.id,
              productId: f.product.id,
              flockId: f.flock.id,
              actorUserId: f.actor.id,
              ...change,
            },
          }),
        );
      await rejects(tx, () =>
        tx.poultryProductSource.create({
          data: {
            organizationId: f.org.id,
            farmId: f.farm.id,
            productId: f.product.id,
            flockId: f.flock.id,
            actorUserId: f.actor.id,
          },
        }),
      );
      await tx.poultryProductSource.update({
        where: { id: f.source.id },
        data: { isActive: false },
      });
      await rejects(tx, () =>
        tx.poultryProductSource.update({
          where: { id: f.source.id },
          data: { flockId: f.otherFlock.id },
        }),
      );
    });
  });

  it('stores exact maximum prices/produce quantities and rejects overflow, negative and fractional EACH values', async () => {
    await withFixture(async (tx, f) => {
      const data = {
        organizationId: f.org.id,
        orderId: f.order.id,
        productId: f.produce.id,
        productCode: f.produce.code,
        productName: f.produce.name,
        kind: 'PRODUCE' as const,
        unit: 'KG' as const,
        inventoryItemId: f.item.id,
        lineNumber: 2,
        orderedQuantity: '999999999999999.999',
        unitPrice: '999999999999999.9999',
      };
      const line = await tx.orderLine.create({ data });
      expect(line.orderedQuantity.toFixed(3)).toBe(data.orderedQuantity);
      expect(line.unitPrice.toFixed(4)).toBe(data.unitPrice);
      for (const change of [
        { unitPrice: '-0.0001' },
        { unitPrice: '1000000000000000' },
        { orderedQuantity: '1000000000000000' },
        { orderedQuantity: '0' },
      ])
        await rejects(tx, () =>
          tx.orderLine.create({ data: { ...data, lineNumber: 3, ...change } }),
        );
      for (const orderedQuantity of ['1.5', '2147483648'])
        await rejects(tx, () =>
          tx.orderLine.update({
            where: { id: f.line.id },
            data: { orderedQuantity },
          }),
        );
      await rejects(
        tx,
        () =>
          tx.$executeRaw`UPDATE "order_lines" SET "unitPrice" = 'NaN'::numeric WHERE "id" = ${line.id}::uuid`,
      );
      // Typmod metadata is checked directly; Zod's rejection of excess input scale is tested in M5-02.
      const columns = await tx.$queryRaw<
        {
          column_name: string;
          numeric_precision: number;
          numeric_scale: number;
        }[]
      >`
        SELECT column_name, numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'order_lines' AND column_name IN ('unitPrice', 'orderedQuantity')`;
      expect(columns).toEqual(
        expect.arrayContaining([
          { column_name: 'unitPrice', numeric_precision: 19, numeric_scale: 4 },
          {
            column_name: 'orderedQuantity',
            numeric_precision: 18,
            numeric_scale: 3,
          },
        ]),
      );
    });
  });

  it('enforces JMD/credit intent, scoped codes and stable line numbers without persisted balances', async () => {
    await withFixture(async (tx, f) => {
      for (const data of [
        { currency: 'USD' },
        { creditTermDays: 30 },
        { saleType: 'CREDIT' as const, creditTermDays: null },
        { saleType: 'CREDIT' as const, creditTermDays: 0 },
      ])
        await rejects(tx, () =>
          tx.order.update({
            where: { id: f.order.id },
            data: { ...data, version: { increment: 1 } },
          }),
        );
      await tx.order.update({
        where: { id: f.order.id },
        data: {
          saleType: 'CREDIT',
          creditTermDays: 30,
          version: { increment: 1 },
        },
      });
      const {
        id: _id,
        createdAt: _created,
        updatedAt: _updated,
        ...lineData
      } = f.line;
      await rejects(tx, () => tx.orderLine.create({ data: lineData }));
      await rejects(tx, () =>
        tx.salesProduct.create({
          data: {
            organizationId: f.org.id,
            code: f.product.code,
            name: 'Duplicate',
            kind: 'POULTRY',
            unit: 'EACH',
          },
        }),
      );
      await tx.salesProduct.create({
        data: {
          organizationId: f.foreignOrg.id,
          code: f.product.code,
          name: 'Separate tenant',
          kind: 'POULTRY',
          unit: 'EACH',
        },
      });
      const columns = await tx.$queryRaw<
        { column_name: string }[]
      >`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'`;
      expect(columns.map((c) => c.column_name)).not.toEqual(
        expect.arrayContaining(['farmId']),
      );
      for (const field of [
        'totalAmount',
        'fulfilledQuantity',
        'remainingQuantity',
        'fulfilmentProgress',
        'dueDate',
      ])
        expect(columns.map((c) => c.column_name)).not.toContain(field);
    });
  });

  it('freezes confirmed customer/line snapshots and prevents reopening or deleting commercial history', async () => {
    await withFixture(async (tx, f) => {
      await confirm(tx, f);
      await tx.customer.update({
        where: { id: f.customer.id },
        data: { name: 'Renamed' },
      });
      await tx.salesProduct.update({
        where: { id: f.product.id },
        data: { name: 'Renamed', isActive: false },
      });
      expect(
        (await tx.order.findUniqueOrThrow({ where: { id: f.order.id } }))
          .customerName,
      ).toBe('Customer');
      expect(
        (await tx.orderLine.findUniqueOrThrow({ where: { id: f.line.id } }))
          .productName,
      ).toBe('Birds');
      await rejects(tx, () =>
        tx.order.update({
          where: { id: f.order.id },
          data: { customerName: 'Changed', version: { increment: 1 } },
        }),
      );
      await rejects(tx, () =>
        tx.orderLine.update({
          where: { id: f.line.id },
          data: { unitPrice: '1' },
        }),
      );
      await rejects(tx, () =>
        tx.orderLine.delete({ where: { id: f.line.id } }),
      );
      await rejects(tx, () =>
        tx.order.update({
          where: { id: f.order.id },
          data: { commercialState: 'DRAFT', version: { increment: 1 } },
        }),
      );
      await tx.order.update({
        where: { id: f.order.id },
        data: { commercialState: 'CANCELLED', version: { increment: 1 } },
      });
      await rejects(tx, () =>
        tx.order.update({
          where: { id: f.order.id },
          data: { commercialState: 'CONFIRMED', version: { increment: 1 } },
        }),
      );
    });
  });

  it('supports partial poultry allocations and compensating depletion without mutating mortality or baseline', async () => {
    await withFixture(async (tx, f) => {
      await confirm(tx, f);
      const first = await batch(tx, f);
      await batch(tx, f, { quantity: '2' });
      await batch(tx, f, { reverse: first });
      const rows = await tx.flockSaleDepletion.findMany({
        where: { flockId: f.flock.id },
      });
      expect(
        rows.reduce(
          (sum, row) =>
            sum + (row.reversesDepletionId ? -row.birdCount : row.birdCount),
          0,
        ),
      ).toBe(2);
      expect(
        (await tx.flock.findUniqueOrThrow({ where: { id: f.flock.id } }))
          .startingBirdCount,
      ).toBe(100);
      expect(
        await tx.mortalityEvent.count({ where: { flockId: f.flock.id } }),
      ).toBe(0);
      expect(
        await tx.inventoryMovement.count({
          where: { organizationId: f.org.id },
        }),
      ).toBe(0);
      await rejects(tx, () => batch(tx, f, { reverse: first }));
    });
  });

  it('requires scoped matching order lines, farms, source units and depletion audit/quantity', async () => {
    await withFixture(async (tx, f) => {
      await confirm(tx, f);
      const posting = await batch(tx, f, {
        omitDepletion: true,
        omitReceipt: true,
      });
      const {
        id: _id,
        createdAt: _created,
        ...allocation
      } = posting.allocation;
      for (const data of [
        { flockId: f.otherFlock.id },
        { farmId: f.otherFarm.id },
        { orderLineId: randomUUID() },
        { orderId: randomUUID() },
        { unit: 'KG' as const },
        { inventoryItemId: f.item.id },
      ])
        await rejects(tx, () =>
          tx.fulfilmentLine.create({ data: { ...allocation, ...data } }),
        );
      const data = {
        organizationId: f.org.id,
        farmId: f.farm.id,
        flockId: f.flock.id,
        fulfilmentLineId: posting.allocation.id,
        birdCount: 3,
        actorUserId: f.actor.id,
        occurredAt: at,
      };
      for (const change of [
        { birdCount: 2 },
        { birdCount: 0 },
        { farmId: f.otherFarm.id },
        { occurredAt: new Date('2026-11-14') },
        { actorUserId: randomUUID() },
      ])
        await rejects(tx, () =>
          tx.flockSaleDepletion.create({ data: { ...data, ...change } }),
        );
      await tx.flockSaleDepletion.create({ data });
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: f.org.id,
          farmId: f.farm.id,
          orderId: f.order.id,
          fulfilmentId: posting.event.id,
          actorUserId: f.actor.id,
          operation: 'POST',
          key: randomUUID(),
          requestHash: 'a'.repeat(64),
          hashVersion: 1,
          orderVersion: 3,
        },
      });
    });
  });

  it('rejects missing poultry ledger or success receipt at the commit boundary', async () => {
    await withFixture(async (tx, f) => {
      await confirm(tx, f);
      for (const options of [{ omitDepletion: true }, { omitReceipt: true }])
        await rejects(tx, async () => {
          await batch(tx, f, options);
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        });
    });
  });

  it('links produce ISSUE/ADJUSTMENT effects and protects the original movement from mutation', async () => {
    await withFixture(async (tx, f) => {
      await tx.orderLine.update({
        where: { id: f.line.id },
        data: {
          productId: f.produce.id,
          productCode: f.produce.code,
          productName: f.produce.name,
          kind: 'PRODUCE',
          unit: 'KG',
          inventoryItemId: f.item.id,
          orderedQuantity: '5',
        },
      });
      await confirm(tx, f);
      const first = await batch(tx, f, { produce: true });
      const reversal = await batch(tx, f, { produce: true, reverse: first });
      expect(first.movement!.reason).toBe('ISSUE');
      expect(reversal.movement!.reason).toBe('ADJUSTMENT');
      expect(first.movement!.quantity.toFixed(3)).toBe('-1.125');
      expect(reversal.movement!.quantity.toFixed(3)).toBe('1.125');
      await rejects(tx, () =>
        tx.inventoryMovement.update({
          where: { id: first.movement!.id },
          data: { quantity: '-2' },
        }),
      );
      await rejects(tx, () =>
        tx.inventoryMovement.delete({ where: { id: first.movement!.id } }),
      );
      await rejects(tx, () =>
        tx.feedUsage.create({
          data: {
            organizationId: f.org.id,
            farmId: f.farm.id,
            flockId: f.flock.id,
            inventoryItemId: f.item.id,
            actorUserId: f.actor.id,
            inventoryMovementId: first.movement!.id,
            quantity: '1.125',
            occurredAt: at,
          },
        }),
      );
    });
  });

  it('retains immutable scoped idempotency receipts and prevents late allocations', async () => {
    await withFixture(async (tx, f) => {
      await confirm(tx, f);
      const first = await batch(tx, f);
      await rejects(tx, () => batch(tx, f, { key: first.receipt!.key }));
      const { id: _id, createdAt: _created, ...receipt } = first.receipt!;
      for (const change of [
        { farmId: f.otherFarm.id },
        { operation: 'REVERSE' as const },
        { actorUserId: randomUUID() },
        { requestHash: 'bad' },
        { hashVersion: 0 },
      ])
        await rejects(tx, () =>
          tx.fulfilmentCommand.create({
            data: { ...receipt, key: randomUUID(), ...change },
          }),
        );
      const { id: _line, createdAt: _lineAt, ...allocation } = first.allocation;
      await rejects(tx, () =>
        tx.fulfilmentLine.create({ data: { ...allocation, quantity: '1' } }),
      );
      for (const table of [
        'fulfilments',
        'fulfilment_lines',
        'flock_sale_depletions',
        'fulfilment_commands',
      ]) {
        await rejects(tx, () =>
          tx.$executeRawUnsafe(
            `UPDATE "${table}" SET "createdAt" = "createdAt"`,
          ),
        );
        await rejects(tx, () =>
          tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE false`),
        );
        await rejects(tx, () =>
          tx.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`),
        );
      }
      await rejects(tx, () =>
        tx.customer.delete({ where: { id: f.customer.id } }),
      );
      await rejects(tx, () => tx.flock.delete({ where: { id: f.flock.id } }));
    });
  });

  it('keeps bounded commercial audit events append-only and unique per order version', async () => {
    await withFixture(async (tx, f) => {
      const data = {
        organizationId: f.org.id,
        orderId: f.order.id,
        actorUserId: f.actor.id,
        action: 'CREATED' as const,
        orderVersion: 1,
        commercialChanges: { after: { saleType: 'CASH' } },
      };
      const event = await tx.orderEvent.create({ data });
      await rejects(tx, () => tx.orderEvent.create({ data }));
      await rejects(tx, () =>
        tx.orderEvent.create({
          data: {
            ...data,
            orderVersion: 2,
            commercialChanges: { text: 'x'.repeat(262144) },
          },
        }),
      );
      await rejects(tx, () =>
        tx.orderEvent.update({
          where: { id: event.id },
          data: { reason: 'Rewrite' },
        }),
      );
      await rejects(tx, () =>
        tx.orderEvent.delete({ where: { id: event.id } }),
      );
    });
  });

  it('rejects incomplete, mismatched and reversal-of-reversal corrections', async () => {
    await withFixture(async (tx, f) => {
      await rejects(tx, () => batch(tx, f)); // draft is not physical demand
      await confirm(tx, f);
      const original = await batch(tx, f, { omitReceipt: true });
      const extraFlock = await tx.flock.create({
        data: {
          organizationId: f.org.id,
          farmId: f.farm.id,
          code: 'FLK-3',
          name: 'Second source',
          startingBirdCount: 100,
          placementDate: at,
        },
      });
      const { id: _id, createdAt: _created, ...line } = original.allocation;
      const extra = await tx.fulfilmentLine.create({
        data: { ...line, flockId: extraFlock.id, sourceCode: extraFlock.code },
      });
      await tx.flockSaleDepletion.create({
        data: {
          organizationId: f.org.id,
          farmId: f.farm.id,
          flockId: extraFlock.id,
          fulfilmentLineId: extra.id,
          birdCount: 3,
          actorUserId: f.actor.id,
          occurredAt: at,
        },
      });
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: f.org.id,
          farmId: f.farm.id,
          orderId: f.order.id,
          fulfilmentId: original.event.id,
          actorUserId: f.actor.id,
          operation: 'POST',
          key: randomUUID(),
          requestHash: 'b'.repeat(64),
          hashVersion: 1,
          orderVersion: 3,
        },
      });
      await rejects(tx, () =>
        batch(tx, f, { reverse: original, quantity: '2' }),
      );
      await rejects(tx, async () => {
        await batch(tx, f, { reverse: original });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });
      const single = await batch(tx, f, { quantity: '1' });
      const reversal = await batch(tx, f, { reverse: single, quantity: '1' });
      await rejects(tx, () =>
        batch(tx, f, { reverse: reversal, quantity: '1' }),
      );
    });
  });

  it('rejects produce movements with wrong sign, reason, audit identity, farm or reused linkage', async () => {
    await withFixture(async (tx, f) => {
      await tx.orderLine.update({
        where: { id: f.line.id },
        data: {
          productId: f.produce.id,
          productCode: f.produce.code,
          productName: f.produce.name,
          kind: 'PRODUCE',
          unit: 'KG',
          inventoryItemId: f.item.id,
        },
      });
      await confirm(tx, f);
      const first = await batch(tx, f, { produce: true, omitReceipt: true });
      const { id: _id, createdAt: _created, ...allocation } = first.allocation;
      for (const change of [
        { quantity: '1.125' },
        { reason: 'ADJUSTMENT' as const },
        { occurredAt: new Date('2026-11-14') },
        { farmId: f.otherFarm.id },
      ]) {
        await rejects(tx, async () => {
          const movement = await tx.inventoryMovement.create({
            data: {
              organizationId: f.org.id,
              farmId: f.farm.id,
              inventoryItemId: f.item.id,
              actorUserId: f.actor.id,
              quantity: '-1.125',
              reason: 'ISSUE',
              occurredAt: at,
              ...change,
            },
          });
          await tx.fulfilmentLine.create({
            data: { ...allocation, inventoryMovementId: movement.id },
          });
        });
      }
      await tx.fulfilmentCommand.create({
        data: {
          organizationId: f.org.id,
          farmId: f.farm.id,
          orderId: f.order.id,
          fulfilmentId: first.event.id,
          actorUserId: f.actor.id,
          operation: 'POST',
          key: randomUUID(),
          requestHash: 'c'.repeat(64),
          hashVersion: 1,
          orderVersion: 3,
        },
      });
      await rejects(tx, async () => {
        const second = await tx.fulfilment.create({
          data: {
            organizationId: f.org.id,
            farmId: f.farm.id,
            orderId: f.order.id,
            code: 'REUSE',
            kind: 'POSTING',
            actorUserId: f.actor.id,
            occurredAt: at,
          },
        });
        await tx.fulfilmentLine.create({
          data: { ...allocation, fulfilmentId: second.id },
        });
      });
    });
  });

  it('commits one complete effect for concurrent same-scope retries and permits separate farm/operation keys', async () => {
    const f = await fresh.$transaction((tx) => seed(tx));
    await fresh.$transaction((tx) => confirm(tx, f));
    const key = randomUUID();
    const results = await Promise.allSettled([
      fresh.$transaction((tx) => batch(tx, f, { key }), { timeout: 20_000 }),
      fresh.$transaction((tx) => batch(tx, f, { key }), { timeout: 20_000 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await fresh.fulfilmentCommand.count({
        where: { organizationId: f.org.id },
      }),
    ).toBe(1);
    expect(
      await fresh.flockSaleDepletion.count({
        where: { organizationId: f.org.id },
      }),
    ).toBe(1);
    expect(
      await fresh.fulfilmentLine.count({ where: { organizationId: f.org.id } }),
    ).toBe(1);
    const success = results.find((r) => r.status === 'fulfilled');
    if (success?.status !== 'fulfilled')
      throw new Error('Expected one committed operation');
    await fresh.$transaction((tx) =>
      batch(tx, f, { key, reverse: success.value }),
    );
    await fresh.$transaction((tx) =>
      batch(tx, { ...f, farm: f.otherFarm, flock: f.otherFlock }, { key }),
    );
    expect(
      await fresh.fulfilmentCommand.count({
        where: { organizationId: f.org.id, key },
      }),
    ).toBe(3);
  });
});
