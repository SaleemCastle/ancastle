-- CreateEnum
CREATE TYPE "InvoiceState" AS ENUM ('ISSUED');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fulfilmentId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'JMD',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" DATE NOT NULL,
    "grossAmount" DECIMAL(19,2) NOT NULL,
    "issuedByMembershipId" UUID NOT NULL,
    "status" "InvoiceState" NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "organizationId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "fulfilmentLineId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "lineAmount" DECIMAL(19,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_fulfilment_allocations" (
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "fulfilmentLineId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,

    CONSTRAINT "invoice_fulfilment_allocations_pkey" PRIMARY KEY ("organizationId","fulfilmentLineId")
);

-- CreateTable
CREATE TABLE "invoice_issue_commands" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" UUID NOT NULL,
    "fulfilmentId" UUID NOT NULL,
    "actorMembershipId" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "invoiceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_issue_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lifecycle_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorMembershipId" UUID NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organizationId_customerId_issuedAt_idx" ON "invoices"("organizationId", "customerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_id_key" ON "invoices"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_farmId_orderId_id_key" ON "invoices"("organizationId", "farmId", "orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_farmId_orderId_fulfilmentId_key" ON "invoices"("organizationId", "farmId", "orderId", "fulfilmentId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_invoiceNumber_key" ON "invoices"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_fulfilmentId_key" ON "invoices"("organizationId", "fulfilmentId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_fulfilmentId_id_key" ON "invoices"("organizationId", "fulfilmentId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_fulfilmentLineId_key" ON "invoice_lines"("fulfilmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_organizationId_farmId_orderId_orderLineId_ful_key" ON "invoice_lines"("organizationId", "farmId", "orderId", "orderLineId", "fulfilmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_fulfilment_allocations_fulfilmentLineId_key" ON "invoice_fulfilment_allocations"("fulfilmentLineId");

-- CreateIndex
CREATE INDEX "invoice_fulfilment_allocations_organizationId_invoiceId_idx" ON "invoice_fulfilment_allocations"("organizationId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_fulfilment_allocations_organizationId_farmId_orderI_key" ON "invoice_fulfilment_allocations"("organizationId", "farmId", "orderId", "orderLineId", "fulfilmentLineId");

-- CreateIndex
CREATE INDEX "invoice_lifecycle_events_organizationId_invoiceId_createdAt_idx" ON "invoice_lifecycle_events"("organizationId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_organizationId_id_key" ON "fulfilments"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_farmId_orderId_fulfilmentId_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "fulfilmentId") REFERENCES "fulfilments"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organizationId_farmId_orderId_invoiceId_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "invoiceId") REFERENCES "invoices"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organizationId_orderId_orderLineId_fkey" FOREIGN KEY ("organizationId", "orderId", "orderLineId") REFERENCES "order_lines"("organizationId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organizationId_farmId_orderId_orderLineId_fu_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "orderLineId", "fulfilmentLineId") REFERENCES "fulfilment_lines"("organizationId", "farmId", "orderId", "orderLineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_fulfilment_allocations" ADD CONSTRAINT "invoice_fulfilment_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_fulfilment_allocations" ADD CONSTRAINT "invoice_allocation_source_line_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "orderLineId", "fulfilmentLineId") REFERENCES "fulfilment_lines"("organizationId", "farmId", "orderId", "orderLineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_fulfilment_allocations" ADD CONSTRAINT "invoice_allocation_invoice_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "invoiceId") REFERENCES "invoices"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_issue_commands" ADD CONSTRAINT "invoice_issue_commands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_issue_commands" ADD CONSTRAINT "invoice_issue_commands_organizationId_fulfilmentId_invoice_fkey" FOREIGN KEY ("organizationId", "fulfilmentId", "invoiceId") REFERENCES "invoices"("organizationId", "fulfilmentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lifecycle_events" ADD CONSTRAINT "invoice_lifecycle_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lifecycle_events" ADD CONSTRAINT "invoice_lifecycle_events_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "invoices"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
