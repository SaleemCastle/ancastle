import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { temporaryDatabase } from '../../test/temporary-database.js';

describe('M6-05 payment migration upgrade (PostgreSQL)', () => {
  it('upgrades an M6-04 database without altering existing invoices', async () => {
    const database = await temporaryDatabase({
      throughMigration: '20261121124000_invoice_amount_capacity',
    });
    try {
      const organization = await database.prisma.organization.create({
        data: {
          name: 'Invoice upgrade fixture',
          slug: `invoice-${randomUUID()}`,
        },
      });
      const user = await database.prisma.user.create({
        data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
      });
      const membership = await database.prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'ADMIN',
        },
      });
      const customer = await database.prisma.customer.create({
        data: {
          organizationId: organization.id,
          code: 'INV-UPGRADE',
          name: 'Invoice upgrade fixture',
          type: 'BUSINESS',
        },
      });
      const farm = await database.prisma.farm.create({
        data: {
          organizationId: organization.id,
          code: 'UPGRADE',
          name: 'Upgrade farm',
        },
      });
      const order = await database.prisma.order.create({
        data: {
          organizationId: organization.id,
          code: 'UPGRADE-ORDER',
          customerId: customer.id,
          saleType: 'CASH',
          customerCode: customer.code,
          customerName: customer.name,
          actorUserId: user.id,
        },
      });
      await database.prisma.$executeRawUnsafe(
        'ALTER TABLE "orders" DISABLE TRIGGER "orders_protect_snapshot"',
      );
      try {
        await database.prisma.$executeRaw`
          UPDATE "orders" SET "commercialState" = 'CONFIRMED', "version" = 2
          WHERE "organizationId" = ${organization.id}::uuid AND "id" = ${order.id}::uuid
        `;
      } finally {
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "orders" ENABLE TRIGGER "orders_protect_snapshot"',
        );
      }
      await database.prisma.$executeRawUnsafe(
        'ALTER TABLE "fulfilments" DISABLE TRIGGER "fulfilments_complete_at_commit"',
      );
      let fulfilmentId: string;
      try {
        fulfilmentId = (
          await database.prisma.fulfilment.create({
            data: {
              organizationId: organization.id,
              farmId: farm.id,
              orderId: order.id,
              code: 'UPGRADE-FULFILMENT',
              kind: 'POSTING',
              actorUserId: user.id,
              occurredAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            select: { id: true },
          })
        ).id;
      } finally {
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "fulfilments" ENABLE TRIGGER "fulfilments_complete_at_commit"',
        );
      }
      await database.prisma.$executeRawUnsafe(
        'ALTER TABLE "invoices" DISABLE TRIGGER "invoice_reconciles_posting"',
      );
      let invoiceId: string;
      try {
        invoiceId = (
          await database.prisma.invoice.create({
            data: {
              organizationId: organization.id,
              farmId: farm.id,
              customerId: customer.id,
              orderId: order.id,
              fulfilmentId,
              invoiceNumber: 'UPGRADE-INV-1',
              issuedAt: new Date('2026-01-01T00:00:00.000Z'),
              dueAt: new Date('2026-01-01T00:00:00.000Z'),
              customerBillingSnapshot: { name: customer.name },
              paymentTermsSnapshot: { terms: 'CASH' },
              grossAmount: '456.78',
              taxTreatmentStatus: 'APPROVED_POLICY_NOT_CALCULATED',
              taxPolicyReference: 'upgrade-test',
              taxPolicyVersion: '1',
              issuedByMembershipId: membership.id,
            },
            select: { id: true },
          })
        ).id;
      } finally {
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "invoices" ENABLE TRIGGER "invoice_reconciles_posting"',
        );
      }
      const before = await database.prisma.invoice.count();
      const connection = await new PrismaPg({
        connectionString: database.connectionString,
      }).connect();
      try {
        const paymentMigration = await readFile(
          new URL(
            '../../../prisma/migrations/20261122110000_m6_payment_recording_allocation/migration.sql',
            import.meta.url,
          ),
          'utf8',
        );
        await connection.underlyingDriver().query(paymentMigration);

        const organization = await database.prisma.organization.create({
          data: { name: 'Upgrade fixture', slug: `upgrade-${randomUUID()}` },
        });
        const user = await database.prisma.user.create({
          data: {
            email: `${randomUUID()}@example.com`,
            passwordHash: 'unused',
          },
        });
        const membership = await database.prisma.organizationMembership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: 'ADMIN',
          },
        });
        const customer = await database.prisma.customer.create({
          data: {
            organizationId: organization.id,
            code: 'UPGRADE',
            name: 'Upgrade fixture',
            type: 'BUSINESS',
          },
        });
        const paymentId = randomUUID();
        await database.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "payments" (
              "id", "organizationId", "customerId", "amount", "currency",
              "method", "cashReceiptNumber", "evidenceKey", "recordedByMembershipId"
            ) VALUES (
              ${paymentId}::uuid, ${organization.id}::uuid, ${customer.id}::uuid,
              23.45, 'JMD', 'CASH', 'Upgrade Receipt', 'upgrade receipt', ${membership.id}::uuid
            )
          `;
          await tx.$executeRaw`
            INSERT INTO "payment_lifecycle_events" (
              "id", "organizationId", "paymentId", "type", "actorMembershipId"
            ) VALUES (
              ${randomUUID()}::uuid, ${organization.id}::uuid, ${paymentId}::uuid,
              'RECORDED', ${membership.id}::uuid
            )
          `;
        });
        const legacyTransferId = randomUUID();
        await database.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "payments" (
              "id", "organizationId", "customerId", "amount", "currency",
              "method", "bankTransferReference", "evidenceKey", "recordedByMembershipId"
            ) VALUES (
              ${legacyTransferId}::uuid, ${organization.id}::uuid, ${customer.id}::uuid,
              9.87, 'JMD', 'BANK_TRANSFER', 'Old Transfer Ref', 'old transfer ref', ${membership.id}::uuid
            )
          `;
          await tx.$executeRaw`
            INSERT INTO "payment_lifecycle_events" (
              "id", "organizationId", "paymentId", "type", "actorMembershipId"
            ) VALUES (
              ${randomUUID()}::uuid, ${organization.id}::uuid, ${legacyTransferId}::uuid,
              'RECORDED', ${membership.id}::uuid
            )
          `;
        });

        const integrityMigration = await readFile(
          new URL(
            '../../../prisma/migrations/20261122120000_m6_payment_integrity_guards/migration.sql',
            import.meta.url,
          ),
          'utf8',
        );
        await connection.underlyingDriver().query(integrityMigration);
        const transactionDateMigration = await readFile(
          new URL(
            '../../../prisma/migrations/20261126120000_payment_transaction_date/migration.sql',
            import.meta.url,
          ),
          'utf8',
        );
        await connection.underlyingDriver().query(transactionDateMigration);
        expect(
          (
            await database.prisma.payment.findUniqueOrThrow({
              where: { id: paymentId },
              select: {
                amount: true,
                evidenceKey: true,
                receivingAccount: true,
              },
            })
          ).amount.toString(),
        ).toBe('23.45');
        const upgradedPayment = await database.prisma.payment.findUniqueOrThrow(
          {
            where: { id: paymentId },
            select: {
              evidenceKey: true,
              receivingAccount: true,
              transactionDate: true,
            },
          },
        );
        expect(upgradedPayment).toEqual({
          evidenceKey: 'CASH:upgradereceipt',
          receivingAccount: null,
          transactionDate: null,
        });
        expect(
          (
            await database.prisma.payment.findUniqueOrThrow({
              where: { id: legacyTransferId },
              select: { evidenceKey: true, receivingAccount: true },
            })
          ).evidenceKey,
        ).toBe('BANK-LEGACY:oldtransferref');
        await expect(
          database.prisma.$transaction(async (tx) => {
            const newPaymentId = randomUUID();
            await tx.$executeRaw`
              INSERT INTO "payments" (
                "id", "organizationId", "customerId", "amount", "currency", "method",
                "receivingAccount", "bankTransferReference", "evidenceKey", "recordedByMembershipId"
              ) VALUES (
                ${newPaymentId}::uuid, ${organization.id}::uuid, ${customer.id}::uuid,
                1.00, 'JMD', 'BANK_TRANSFER', 'account-new', 'Old Transfer Ref',
                'BANK:11:account-new:oldtransferref', ${membership.id}::uuid
              )
            `;
          }),
        ).rejects.toThrow();
      } finally {
        await connection.dispose();
      }
      expect(await database.prisma.payment.count()).toBe(2);
      expect(await database.prisma.invoice.count()).toBe(before);
      const preservedInvoice = await database.prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { grossAmount: true, invoiceNumber: true },
      });
      expect(preservedInvoice.invoiceNumber).toBe('UPGRADE-INV-1');
      expect(preservedInvoice.grossAmount.toString()).toBe('456.78');
      const relations = await database.prisma.$queryRaw<
        { name: string | null }[]
      >`
        SELECT to_regclass('payment_allocations')::text AS name
      `;
      expect(relations[0]?.name).toBe('payment_allocations');
      const moneyColumns = await database.prisma.$queryRaw<
        {
          table_name: string;
          column_name: string;
          precision: number;
          scale: number;
        }[]
      >`
        SELECT table_name, column_name, numeric_precision AS precision, numeric_scale AS scale
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (
            ('payments', 'amount'),
            ('payment_allocations', 'amount'),
            ('payment_allocation_reversals', 'amount'),
            ('invoices', 'grossAmount')
          )
      `;
      expect(moneyColumns).toHaveLength(4);
      expect(
        moneyColumns.every(
          (column) => column.precision === 34 && column.scale === 2,
        ),
      ).toBe(true);
    } finally {
      await database.dispose();
    }
  }, 120_000);
});
