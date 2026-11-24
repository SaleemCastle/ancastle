import { randomUUID } from 'node:crypto';
import { temporaryDatabase } from '../../test/temporary-database.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { OrganizationContext } from '../authorization/organization-context.js';
import { ReceivablesService } from './receivables.service.js';

describe('M6-06 receivables and customer statements (PostgreSQL)', () => {
  it('derives outstanding, unapplied cash and historical statement cutoffs from ledger events', async () => {
    const database = await temporaryDatabase();
    try {
      const org = await database.prisma.organization.create({
        data: { name: 'Receivables', slug: `recv-${randomUUID()}` },
      });
      const user = await database.prisma.user.create({
        data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
      });
      const membership = await database.prisma.organizationMembership.create({
        data: { organizationId: org.id, userId: user.id, role: 'ADMIN' },
      });
      const customer = await database.prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'C-1',
          name: 'Customer One',
          type: 'BUSINESS',
        },
      });
      const farm = await database.prisma.farm.create({
        data: { organizationId: org.id, code: 'F-1', name: 'Farm One' },
      });
      const context = new OrganizationContext(
        org.id,
        membership.id,
        user.id,
        'ADMIN',
      );
      const service = new ReceivablesService(
        database.prisma,
        new AuthorizationService(),
      );

      const addInvoice = async (
        invoiceNumber: string,
        amount: string,
        issuedAt: string,
        dueAt: string,
        customerId = customer.id,
        customerCode = customer.code,
        customerName = customer.name,
      ) => {
        const order = await database.prisma.order.create({
          data: {
            organizationId: org.id,
            code: `O-${randomUUID()}`,
            customerId,
            saleType: 'CASH',
            customerCode,
            customerName,
            actorUserId: user.id,
          },
        });
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "orders" DISABLE TRIGGER "orders_protect_snapshot"',
        );
        try {
          await database.prisma
            .$executeRaw`UPDATE "orders" SET "commercialState"='CONFIRMED', "version"=2 WHERE "organizationId"=${org.id}::uuid AND "id"=${order.id}::uuid`;
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
          const fulfilment = await database.prisma.fulfilment.create({
            data: {
              organizationId: org.id,
              farmId: farm.id,
              orderId: order.id,
              code: `F-${randomUUID()}`,
              kind: 'POSTING',
              actorUserId: user.id,
              occurredAt: new Date(issuedAt),
            },
            select: { id: true },
          });
          fulfilmentId = fulfilment.id;
        } finally {
          await database.prisma.$executeRawUnsafe(
            'ALTER TABLE "fulfilments" ENABLE TRIGGER "fulfilments_complete_at_commit"',
          );
        }
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "invoices" DISABLE TRIGGER "invoice_reconciles_posting"',
        );
        try {
          return await database.prisma.invoice.create({
            data: {
              organizationId: org.id,
              farmId: farm.id,
              customerId,
              orderId: order.id,
              fulfilmentId: fulfilmentId!,
              invoiceNumber,
              issuedAt: new Date(issuedAt),
              dueAt: new Date(`${dueAt}T00:00:00.000Z`),
              customerBillingSnapshot: {},
              paymentTermsSnapshot: { saleType: 'CASH', creditTermDays: null },
              grossAmount: amount,
              taxTreatmentStatus: 'APPROVED_POLICY_NOT_CALCULATED',
              taxPolicyReference: 'fixture',
              taxPolicyVersion: '1',
              issuedByMembershipId: membership.id,
            },
          });
        } finally {
          await database.prisma.$executeRawUnsafe(
            'ALTER TABLE "invoices" ENABLE TRIGGER "invoice_reconciles_posting"',
          );
        }
      };

      const invoice = await addInvoice(
        'INV-1',
        '100.00',
        '2026-11-01T15:00:00.000Z',
        '2026-11-05',
      );
      const paidInvoice = await addInvoice(
        'INV-2',
        '50.00',
        '2026-11-02T15:00:00.000Z',
        '2026-11-02',
      );
      const maxInvoiceA = await addInvoice(
        'INV-MAX-A',
        '99999999999999999999999999999999.99',
        '2026-11-03T15:00:00.000Z',
        '2026-11-03',
      );
      await addInvoice(
        'INV-MAX-B',
        '99999999999999999999999999999999.99',
        '2026-11-04T15:00:00.000Z',
        '2026-11-04',
      );
      const agingCustomer = await database.prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'C-AGING',
          name: 'Aging Customer',
          type: 'BUSINESS',
        },
      });
      for (const [index, dueDate] of [
        '2026-11-30',
        '2026-11-29',
        '2026-10-31',
        '2026-10-30',
        '2026-10-01',
        '2026-09-30',
        '2026-09-01',
        '2026-08-31',
      ].entries()) {
        await addInvoice(
          `INV-AGING-${index}`,
          '1.00',
          '2026-11-01T12:00:00.000Z',
          dueDate!,
          agingCustomer.id,
          agingCustomer.code,
          agingCustomer.name,
        );
      }
      const statementCustomer = await database.prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'C-STMT',
          name: 'Statement Customer',
          type: 'BUSINESS',
        },
      });
      await addInvoice(
        'INV-OPENING',
        '10.00',
        '2026-10-31T12:00:00.000Z',
        '2026-11-01',
        statementCustomer.id,
        statementCustomer.code,
        statementCustomer.name,
      );
      const lastJamaicaDay = await addInvoice(
        'INV-TO-INCLUSIVE',
        '5.00',
        '2026-12-01T04:59:59.999Z',
        '2026-12-01',
        statementCustomer.id,
        statementCustomer.code,
        statementCustomer.name,
      );
      const afterJamaicaDay = await addInvoice(
        'INV-AFTER-TO',
        '7.00',
        '2026-12-01T05:00:00.001Z',
        '2026-12-02',
        statementCustomer.id,
        statementCustomer.code,
        statementCustomer.name,
      );
      const addPayment = async (
        receipt: string,
        amount: string,
        recordedAt: string,
        allocation?: { invoiceId: string; amount: string; createdAt: string },
        reverseAt?: string,
        paymentCustomerId = customer.id,
      ) => {
        const paymentId = randomUUID();
        await database.prisma.$transaction(async (tx) => {
          await tx.payment.create({
            data: {
              id: paymentId,
              organizationId: org.id,
              customerId: paymentCustomerId,
              amount,
              currency: 'JMD',
              method: 'CASH',
              cashReceiptNumber: receipt,
              receivingAccount: null,
              bankTransferReference: null,
              evidenceKey: `CASH:${receipt.toLowerCase()}`,
              recordedByMembershipId: membership.id,
              recordedAt: new Date(recordedAt),
            },
          });
          await tx.paymentLifecycleEvent.createMany({
            data: [
              {
                organizationId: org.id,
                paymentId,
                type: 'RECORDED',
                actorMembershipId: membership.id,
                createdAt: new Date(recordedAt),
              },
              ...(!receipt.startsWith('PENDING')
                ? [
                    {
                      organizationId: org.id,
                      paymentId,
                      type: 'VERIFIED' as const,
                      actorMembershipId: membership.id,
                      selfVerification: true,
                      createdAt: new Date(
                        new Date(recordedAt).getTime() + 60_000,
                      ),
                    },
                  ]
                : []),
            ],
          });
          let allocationId: string | undefined;
          if (allocation) {
            const row = await tx.paymentAllocation.create({
              data: {
                organizationId: org.id,
                paymentId,
                invoiceId: allocation.invoiceId,
                customerId: paymentCustomerId,
                currency: 'JMD',
                amount: allocation.amount,
                allocatedByMembershipId: membership.id,
                createdAt: new Date(allocation.createdAt),
              },
            });
            allocationId = row.id;
          }
          if (reverseAt && allocationId) {
            await tx.paymentAllocationReversal.create({
              data: {
                organizationId: org.id,
                paymentId,
                allocationId,
                amount: allocation!.amount,
                reason: 'Fixture reversal',
                actorMembershipId: membership.id,
                createdAt: new Date(reverseAt),
              },
            });
            await tx.paymentLifecycleEvent.create({
              data: {
                organizationId: org.id,
                paymentId,
                type: 'REVERSED',
                actorMembershipId: membership.id,
                reason: 'Fixture reversal',
                createdAt: new Date(reverseAt),
              },
            });
          }
        });
        return paymentId;
      };
      await addPayment('PENDING-1', '20.00', '2026-11-08T15:00:00.000Z');
      await addPayment(
        'REVERSED-1',
        '30.00',
        '2026-11-09T15:00:00.000Z',
        {
          invoiceId: invoice.id,
          amount: '30.00',
          createdAt: '2026-11-10T15:00:00.000Z',
        },
        '2026-11-20T15:00:00.000Z',
      );
      await addPayment('PARTIAL-1', '25.00', '2026-11-11T15:00:00.000Z', {
        invoiceId: invoice.id,
        amount: '25.00',
        createdAt: '2026-11-12T15:00:00.000Z',
      });
      await addPayment('PAID-1', '50.00', '2026-11-12T15:00:00.000Z', {
        invoiceId: paidInvoice.id,
        amount: '50.00',
        createdAt: '2026-11-13T15:00:00.000Z',
      });
      await addPayment('UNAPPLIED-1', '45.00', '2026-11-14T15:00:00.000Z');

      const balances = await service.listInvoices(context, {
        page: 1,
        pageSize: 100,
        asOfDate: '2026-11-30',
      });
      expect(
        balances.data.find((row) => row.invoiceId === invoice.id),
      ).toMatchObject({
        status: 'PARTIALLY_PAID',
        outstandingAmount: '75.00',
        overdue: true,
      });
      expect(
        balances.data.find((row) => row.invoiceId === paidInvoice.id)?.status,
      ).toBe('PAID');
      expect(
        balances.data.find((row) => row.invoiceId === maxInvoiceA.id)
          ?.outstandingAmount,
      ).toBe('99999999999999999999999999999999.99');
      const customerSummary = await service.getCustomer(
        context,
        customer.id,
        '2026-11-30',
      );
      expect(customerSummary.data.unappliedCash).toBe('45.00');
      expect(customerSummary.data.totalOutstanding).toBe(
        '200000000000000000000000000000074.98',
      );
      const aging = await service.getCustomer(
        context,
        agingCustomer.id,
        '2026-11-30',
      );
      expect(aging.data.aging).toEqual({
        current: '1.00',
        days1To30: '2.00',
        days31To60: '2.00',
        days61To90: '2.00',
        over90: '1.00',
      });
      const customers = await service.listCustomers(context, {
        page: 1,
        pageSize: 100,
        search: 'Customer',
        asOfDate: '2026-11-30',
      });
      expect(
        customers.data.find((row) => row.customerId === customer.id)
          ?.totalOutstanding,
      ).toBe(customerSummary.data.totalOutstanding);
      expect(
        customers.data.find((row) => row.customerId === agingCustomer.id)?.aging
          .over90,
      ).toBe('1.00');

      const beforeReversal = await service.statement(context, customer.id, {
        from: '2026-11-01',
        to: '2026-11-30',
        asOf: '2026-11-15T23:59:59.999Z',
        page: 1,
        pageSize: 100,
      });
      expect(
        beforeReversal.data.entries.some(
          (row) => row.type === 'PAYMENT_ALLOCATION',
        ),
      ).toBe(true);
      expect(
        beforeReversal.data.entries.some(
          (row) => row.type === 'ALLOCATION_REVERSAL',
        ),
      ).toBe(false);
      expect(beforeReversal.data.closingBalance).toBe(
        '200000000000000000000000000000044.98',
      );
      const afterReversal = await service.statement(context, customer.id, {
        from: '2026-11-01',
        to: '2026-11-30',
        page: 1,
        pageSize: 100,
      });
      expect(
        afterReversal.data.entries.some(
          (row) => row.type === 'ALLOCATION_REVERSAL',
        ),
      ).toBe(true);
      expect(afterReversal.data.closingBalance).toBe(
        '200000000000000000000000000000074.98',
      );
      const repeated = await service.statement(context, customer.id, {
        from: '2026-11-01',
        to: '2026-11-30',
        page: 1,
        pageSize: 100,
      });
      expect(afterReversal.data.entries.map((row) => row.id)).toEqual(
        repeated.data.entries.map((row) => row.id),
      );

      const statementBoundaries = await service.statement(
        context,
        statementCustomer.id,
        { from: '2026-11-01', to: '2026-11-30', page: 1, pageSize: 20 },
      );
      expect(statementBoundaries.data.asOfAt).toBe('2026-12-01T04:59:59.999Z');
      expect(
        statementBoundaries.data.entries.map((row) => ({
          number: row.invoiceNumber,
          date: row.businessDate,
          at: row.effectiveAt,
        })),
      ).toContainEqual({
        number: 'INV-TO-INCLUSIVE',
        date: '2026-11-30',
        at: '2026-12-01T04:59:59.999Z',
      });
      expect(statementBoundaries.data.openingBalance).toBe('10.00');
      expect(statementBoundaries.data.closingBalance).toBe('15.00');
      expect(
        statementBoundaries.data.entries.map((row) => row.invoiceId),
      ).toContain(lastJamaicaDay.id);
      expect(
        statementBoundaries.data.entries.map((row) => row.invoiceId),
      ).not.toContain(afterJamaicaDay.id);

      const cutoffCustomer = await database.prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'C-CUTOFF',
          name: 'Cutoff Customer',
          type: 'BUSINESS',
        },
      });
      const cutoffIssuedAt = '2026-11-10T12:00:00.000Z';
      const cutoffInvoice = await addInvoice(
        'INV-CUTOFF-ALLOC',
        '20.00',
        cutoffIssuedAt,
        '2026-11-10',
        cutoffCustomer.id,
        cutoffCustomer.code,
        cutoffCustomer.name,
      );
      const cutoffReversalInvoice = await addInvoice(
        'INV-CUTOFF-REVERSAL',
        '10.00',
        cutoffIssuedAt,
        '2026-11-10',
        cutoffCustomer.id,
        cutoffCustomer.code,
        cutoffCustomer.name,
      );
      const afterCutoffInvoice = await addInvoice(
        'INV-CUTOFF-AFTER',
        '8.00',
        cutoffIssuedAt,
        '2026-11-10',
        cutoffCustomer.id,
        cutoffCustomer.code,
        cutoffCustomer.name,
      );
      const cutoffAt = '2026-11-10T23:59:59.999Z';
      const beforeCutoffRecordedAt = '2026-11-10T23:57:59.999Z';
      await addPayment(
        'CUTOFF-ALLOC',
        '5.00',
        beforeCutoffRecordedAt,
        { invoiceId: cutoffInvoice.id, amount: '5.00', createdAt: cutoffAt },
        undefined,
        cutoffCustomer.id,
      );
      await addPayment(
        'CUTOFF-REVERSAL',
        '3.00',
        beforeCutoffRecordedAt,
        {
          invoiceId: cutoffReversalInvoice.id,
          amount: '3.00',
          createdAt: '2026-11-10T23:59:59.998Z',
        },
        cutoffAt,
        cutoffCustomer.id,
      );
      await addPayment(
        'CUTOFF-AFTER',
        '2.00',
        beforeCutoffRecordedAt,
        {
          invoiceId: afterCutoffInvoice.id,
          amount: '2.00',
          createdAt: '2026-11-11T00:00:00.000Z',
        },
        undefined,
        cutoffCustomer.id,
      );
      const exactCutoffStatement = await service.statement(
        context,
        cutoffCustomer.id,
        {
          from: '2026-11-10',
          to: '2026-11-10',
          asOf: cutoffAt,
          page: 1,
          pageSize: 100,
        },
      );
      expect(exactCutoffStatement.data.closingBalance).toBe('33.00');
      expect(exactCutoffStatement.data.openingBalance).toBe('0.00');
      expect(
        exactCutoffStatement.data.entries.filter(
          (entry) => entry.type === 'PAYMENT_ALLOCATION',
        ),
      ).toHaveLength(2);
      expect(
        exactCutoffStatement.data.entries.filter(
          (entry) => entry.type === 'ALLOCATION_REVERSAL',
        ),
      ).toHaveLength(1);
      expect(
        exactCutoffStatement.data.entries.some(
          (entry) => entry.effectiveAt === '2026-11-11T00:00:00.000Z',
        ),
      ).toBe(false);
      expect(JSON.stringify(exactCutoffStatement.data)).not.toContain(
        'cashReceiptNumber',
      );
      const firstCutoffPage = await service.statement(
        context,
        cutoffCustomer.id,
        {
          from: '2026-11-10',
          to: '2026-11-10',
          asOf: cutoffAt,
          page: 1,
          pageSize: 2,
        },
      );
      const secondCutoffPage = await service.statement(
        context,
        cutoffCustomer.id,
        {
          from: '2026-11-10',
          to: '2026-11-10',
          asOf: cutoffAt,
          page: 2,
          pageSize: 2,
        },
      );
      const thirdCutoffPage = await service.statement(
        context,
        cutoffCustomer.id,
        {
          from: '2026-11-10',
          to: '2026-11-10',
          asOf: cutoffAt,
          page: 3,
          pageSize: 2,
        },
      );
      expect(
        [
          ...firstCutoffPage.data.entries,
          ...secondCutoffPage.data.entries,
          ...thirdCutoffPage.data.entries,
        ].map((entry) => entry.id),
      ).toEqual(exactCutoffStatement.data.entries.map((entry) => entry.id));

      const concurrentReads = [
        service.statement(context, customer.id, {
          from: '2026-11-01',
          to: '2026-11-30',
          page: 1,
          pageSize: 100,
        }),
        service.statement(context, customer.id, {
          from: '2026-11-01',
          to: '2026-11-30',
          page: 1,
          pageSize: 100,
        }),
      ];
      await Promise.all([
        ...concurrentReads,
        addPayment('CONCURRENT-1', '10.00', '2026-11-24T15:00:00.000Z', {
          invoiceId: invoice.id,
          amount: '10.00',
          createdAt: '2026-11-25T15:00:00.000Z',
        }),
      ]);
      for (const snapshotPromise of concurrentReads) {
        const snapshot = await snapshotPromise;
        const signedEntries = snapshot.data.entries.reduce(
          (sum, entry) =>
            sum +
            (entry.direction === 'DEBIT' ? 1n : -1n) *
              BigInt(entry.amount.replace('.', '')),
          0n,
        );
        const openingCents = BigInt(
          snapshot.data.openingBalance.replace('.', ''),
        );
        const closingCents = BigInt(
          snapshot.data.closingBalance.replace('.', ''),
        );
        expect(openingCents + signedEntries).toBe(closingCents);
        expect([
          '200000000000000000000000000000064.98',
          '200000000000000000000000000000074.98',
        ]).toContain(snapshot.data.closingBalance);
      }
      const frozenHistorical = await service.statement(context, customer.id, {
        from: '2026-11-01',
        to: '2026-11-30',
        asOf: '2026-11-15T23:59:59.999Z',
        page: 1,
        pageSize: 100,
      });
      expect(frozenHistorical.data.closingBalance).toBe(
        beforeReversal.data.closingBalance,
      );

      const otherOrg = await database.prisma.organization.create({
        data: { name: 'Other', slug: `other-${randomUUID()}` },
      });
      const otherCustomer = await database.prisma.customer.create({
        data: {
          organizationId: otherOrg.id,
          code: 'OTHER',
          name: 'Other Customer',
          type: 'BUSINESS',
        },
      });
      await expect(
        service.getCustomer(context, otherCustomer.id),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
      await expect(
        service.statement(context, otherCustomer.id, {
          from: '2026-11-01',
          to: '2026-11-30',
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
      const staffUser = await database.prisma.user.create({
        data: { email: `${randomUUID()}@example.com`, passwordHash: 'unused' },
      });
      const staffMembership =
        await database.prisma.organizationMembership.create({
          data: { organizationId: org.id, userId: staffUser.id, role: 'STAFF' },
        });
      const staffContext = new OrganizationContext(
        org.id,
        staffMembership.id,
        staffUser.id,
        'STAFF',
      );
      await expect(
        service.listInvoices(staffContext, { page: 1, pageSize: 20 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        service.statement(staffContext, customer.id, {
          from: '2026-11-01',
          to: '2026-11-30',
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await database.prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { isActive: false },
      });
      await expect(
        service.getCustomer(context, customer.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await database.prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { isActive: true },
      });
      await database.prisma.organization.update({
        where: { id: org.id },
        data: { isActive: false },
      });
      await expect(
        service.getCustomer(context, customer.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await database.dispose();
    }
  }, 30_000);
});
