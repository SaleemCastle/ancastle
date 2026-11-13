BEGIN;

-- CreateEnum
CREATE TYPE "SalesProductKind" AS ENUM ('POULTRY', 'PRODUCE');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "OrderEventAction" AS ENUM ('CREATED', 'AMENDED', 'CONFIRMED', 'CANCELLED', 'FULFILMENT_POSTED', 'FULFILMENT_REVERSED');

-- CreateEnum
CREATE TYPE "FulfilmentKind" AS ENUM ('POSTING', 'REVERSAL');

-- CreateEnum
CREATE TYPE "FulfilmentOperation" AS ENUM ('POST', 'REVERSE');

-- CreateTable
CREATE TABLE "sales_products" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SalesProductKind" NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "inventoryItemId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poultry_product_sources" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "flockId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poultry_product_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "commercialState" "OrderState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'JMD',
    "saleType" "SaleType" NOT NULL,
    "creditTermDays" INTEGER,
    "customerCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerContactPerson" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "customerAddress" TEXT,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "kind" "SalesProductKind" NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "inventoryItemId" UUID,
    "orderedQuantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "action" "OrderEventAction" NOT NULL,
    "orderVersion" INTEGER NOT NULL,
    "actorUserId" UUID NOT NULL,
    "reason" TEXT,
    "commercialChanges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "FulfilmentKind" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "reference" TEXT,
    "reason" TEXT,
    "postingErrorConfirmed" BOOLEAN,
    "reversesFulfilmentId" UUID,

    CONSTRAINT "fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilment_lines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fulfilmentId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "kind" "SalesProductKind" NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "flockId" UUID,
    "inventoryItemId" UUID,
    "inventoryMovementId" UUID,
    "reversesLineId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfilment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flock_sale_depletions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "flockId" UUID NOT NULL,
    "fulfilmentLineId" UUID NOT NULL,
    "birdCount" INTEGER NOT NULL,
    "actorUserId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesDepletionId" UUID,

    CONSTRAINT "flock_sale_depletions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilment_commands" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "operation" "FulfilmentOperation" NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "hashVersion" INTEGER NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fulfilmentId" UUID NOT NULL,
    "orderVersion" INTEGER NOT NULL,
    "responseStatus" INTEGER NOT NULL DEFAULT 201,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfilment_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_products_organizationId_isActive_kind_idx" ON "sales_products"("organizationId", "isActive", "kind");

-- CreateIndex
CREATE INDEX "sales_products_organizationId_inventoryItemId_idx" ON "sales_products"("organizationId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_products_organizationId_id_key" ON "sales_products"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_products_organizationId_code_key" ON "sales_products"("organizationId", "code");

-- CreateIndex
CREATE INDEX "poultry_sources_scope_active_idx" ON "poultry_product_sources"("organizationId", "farmId", "productId", "isActive");

-- CreateIndex
CREATE INDEX "poultry_product_sources_organizationId_farmId_flockId_idx" ON "poultry_product_sources"("organizationId", "farmId", "flockId");

-- CreateIndex
CREATE INDEX "poultry_product_sources_actorUserId_idx" ON "poultry_product_sources"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "poultry_sources_product_flock_key" ON "poultry_product_sources"("organizationId", "productId", "farmId", "flockId");

-- CreateIndex
CREATE INDEX "orders_organizationId_customerId_idx" ON "orders"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "orders_scope_state_created_idx" ON "orders"("organizationId", "commercialState", "createdAt", "id");

-- CreateIndex
CREATE INDEX "orders_actorUserId_idx" ON "orders"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organizationId_id_key" ON "orders"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organizationId_code_key" ON "orders"("organizationId", "code");

-- CreateIndex
CREATE INDEX "order_lines_organizationId_productId_idx" ON "order_lines"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "order_lines_organizationId_inventoryItemId_idx" ON "order_lines"("organizationId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_organizationId_orderId_id_key" ON "order_lines"("organizationId", "orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_organizationId_orderId_lineNumber_key" ON "order_lines"("organizationId", "orderId", "lineNumber");

-- CreateIndex
CREATE INDEX "order_events_organizationId_orderId_createdAt_id_idx" ON "order_events"("organizationId", "orderId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "order_events_actorUserId_idx" ON "order_events"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_organizationId_orderId_orderVersion_key" ON "order_events"("organizationId", "orderId", "orderVersion");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_reversesFulfilmentId_key" ON "fulfilments"("reversesFulfilmentId");

-- CreateIndex
CREATE INDEX "fulfilments_scope_history_idx" ON "fulfilments"("organizationId", "farmId", "orderId", "occurredAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "fulfilments_organizationId_orderId_idx" ON "fulfilments"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "fulfilments_actorUserId_idx" ON "fulfilments"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_scope_id_key" ON "fulfilments"("organizationId", "farmId", "orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_organizationId_code_key" ON "fulfilments"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_inventoryMovementId_key" ON "fulfilment_lines"("inventoryMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_reversesLineId_key" ON "fulfilment_lines"("reversesLineId");

-- CreateIndex
CREATE INDEX "fulfilment_lines_organizationId_orderId_orderLineId_idx" ON "fulfilment_lines"("organizationId", "orderId", "orderLineId");

-- CreateIndex
CREATE INDEX "fulfilment_lines_flock_history_idx" ON "fulfilment_lines"("organizationId", "farmId", "flockId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "fulfilment_lines_stock_history_idx" ON "fulfilment_lines"("organizationId", "farmId", "inventoryItemId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_scope_id_key" ON "fulfilment_lines"("organizationId", "farmId", "orderId", "orderLineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_flock_id_key" ON "fulfilment_lines"("organizationId", "farmId", "flockId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_poultry_source_key" ON "fulfilment_lines"("fulfilmentId", "orderLineId", "flockId");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_lines_produce_source_key" ON "fulfilment_lines"("fulfilmentId", "orderLineId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "flock_sale_depletions_fulfilmentLineId_key" ON "flock_sale_depletions"("fulfilmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "flock_sale_depletions_reversesDepletionId_key" ON "flock_sale_depletions"("reversesDepletionId");

-- CreateIndex
CREATE INDEX "flock_sale_depletions_history_idx" ON "flock_sale_depletions"("organizationId", "farmId", "flockId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "flock_sale_depletions_actorUserId_idx" ON "flock_sale_depletions"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "flock_sale_depletions_scope_id_key" ON "flock_sale_depletions"("organizationId", "farmId", "flockId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_commands_fulfilmentId_key" ON "fulfilment_commands"("fulfilmentId");

-- CreateIndex
CREATE INDEX "fulfilment_commands_organizationId_orderId_idx" ON "fulfilment_commands"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "fulfilment_commands_actorUserId_idx" ON "fulfilment_commands"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilment_commands_scope_key" ON "fulfilment_commands"("organizationId", "farmId", "operation", "key");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_id_key" ON "customers"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "sales_products" ADD CONSTRAINT "sales_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_products" ADD CONSTRAINT "sales_products_organizationId_inventoryItemId_fkey" FOREIGN KEY ("organizationId", "inventoryItemId") REFERENCES "inventory_items"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "sales_products"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_organizationId_farmId_flockId_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId") REFERENCES "flocks"("organizationId", "farmId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "poultry_product_sources" ADD CONSTRAINT "poultry_product_sources_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "sales_products"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_organizationId_inventoryItemId_fkey" FOREIGN KEY ("organizationId", "inventoryItemId") REFERENCES "inventory_items"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_organizationId_farmId_orderId_reversesFulfilme_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "reversesFulfilmentId") REFERENCES "fulfilments"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_orderId_orderLineId_fkey" FOREIGN KEY ("organizationId", "orderId", "orderLineId") REFERENCES "order_lines"("organizationId", "orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_farmId_orderId_fulfilmentI_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "fulfilmentId") REFERENCES "fulfilments"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_farmId_flockId_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId") REFERENCES "flocks"("organizationId", "farmId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_inventoryItemId_fkey" FOREIGN KEY ("organizationId", "inventoryItemId") REFERENCES "inventory_items"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_farmId_inventoryItemId_inv_fkey" FOREIGN KEY ("organizationId", "farmId", "inventoryItemId", "inventoryMovementId") REFERENCES "inventory_movements"("organizationId", "farmId", "inventoryItemId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_organizationId_farmId_orderId_orderLineId_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "orderLineId", "reversesLineId") REFERENCES "fulfilment_lines"("organizationId", "farmId", "orderId", "orderLineId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_farmId_flockId_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId") REFERENCES "flocks"("organizationId", "farmId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_farmId_flockId_fulfil_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId", "fulfilmentLineId") REFERENCES "fulfilment_lines"("organizationId", "farmId", "flockId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_organizationId_farmId_flockId_revers_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId", "reversesDepletionId") REFERENCES "flock_sale_depletions"("organizationId", "farmId", "flockId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_organizationId_farmId_orderId_fulfilme_fkey" FOREIGN KEY ("organizationId", "farmId", "orderId", "fulfilmentId") REFERENCES "fulfilments"("organizationId", "farmId", "orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-only integrity: Prisma cannot express CHECKs or deferred constraint triggers.
ALTER TABLE "sales_products" ADD CONSTRAINT "sales_products_source_check" CHECK (
    ("kind" = 'POULTRY' AND "unit" = 'EACH' AND "inventoryItemId" IS NULL) OR
    ("kind" = 'PRODUCE' AND "inventoryItemId" IS NOT NULL)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_commercial_check" CHECK (
    "currency" = 'JMD' AND "version" > 0 AND
    (("saleType" = 'CASH' AND "creditTermDays" IS NULL) OR
     ("saleType" = 'CREDIT' AND "creditTermDays" IS NOT NULL AND "creditTermDays" > 0))
);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_snapshot_check" CHECK (
    "lineNumber" > 0 AND "lineNumber" <= 100 AND
    "orderedQuantity" > 0 AND "orderedQuantity" <= 999999999999999.999 AND
    "unitPrice" >= 0 AND "unitPrice" <= 999999999999999.9999 AND
    ("unit" <> 'EACH' OR "orderedQuantity" = trunc("orderedQuantity")) AND
    (("kind" = 'POULTRY' AND "unit" = 'EACH' AND "inventoryItemId" IS NULL AND "orderedQuantity" <= 2147483647) OR
     ("kind" = 'PRODUCE' AND "inventoryItemId" IS NOT NULL))
);
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_changes_check" CHECK (
    "orderVersion" > 0 AND jsonb_typeof("commercialChanges") = 'object' AND
    octet_length("commercialChanges"::text) <= 262144 AND
    ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 2000)
);
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_correction_check" CHECK (
    ("kind" = 'POSTING' AND "reversesFulfilmentId" IS NULL AND "reason" IS NULL AND "postingErrorConfirmed" IS NULL) OR
    ("kind" = 'REVERSAL' AND "reversesFulfilmentId" IS NOT NULL AND "reversesFulfilmentId" <> "id" AND
     "reason" IS NOT NULL AND char_length(btrim("reason")) BETWEEN 1 AND 2000 AND "postingErrorConfirmed" IS TRUE)
);
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_text_check" CHECK (
    ("note" IS NULL OR char_length("note") <= 2000) AND
    ("reference" IS NULL OR char_length("reference") <= 120)
);
ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_source_check" CHECK (
    "quantity" > 0 AND "quantity" <= 999999999999999.999 AND
    ("unit" <> 'EACH' OR "quantity" = trunc("quantity")) AND
    ("reversesLineId" IS NULL OR "reversesLineId" <> "id") AND
    (("kind" = 'POULTRY' AND "unit" = 'EACH' AND "quantity" <= 2147483647 AND "flockId" IS NOT NULL AND
      "inventoryItemId" IS NULL AND "inventoryMovementId" IS NULL) OR
     ("kind" = 'PRODUCE' AND "flockId" IS NULL AND "inventoryItemId" IS NOT NULL AND "inventoryMovementId" IS NOT NULL))
);
ALTER TABLE "flock_sale_depletions" ADD CONSTRAINT "flock_sale_depletions_count_check" CHECK (
    "birdCount" > 0 AND ("reversesDepletionId" IS NULL OR "reversesDepletionId" <> "id")
);
ALTER TABLE "fulfilment_commands" ADD CONSTRAINT "fulfilment_commands_receipt_check" CHECK (
    "requestHash" ~ '^[0-9a-f]{64}$' AND "hashVersion" > 0 AND "orderVersion" > 0 AND "responseStatus" BETWEEN 200 AND 299
);

CREATE FUNCTION "validate_sales_definition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'sales_products' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW."id", NEW."organizationId", NEW."code", NEW."createdAt") IS DISTINCT FROM
               (OLD."id", OLD."organizationId", OLD."code", OLD."createdAt") THEN
                RAISE EXCEPTION 'Sales product identity is immutable' USING ERRCODE = '23514';
            END IF;
            IF (NEW."kind", NEW."unit", NEW."inventoryItemId") IS DISTINCT FROM
               (OLD."kind", OLD."unit", OLD."inventoryItemId") AND
               (EXISTS (SELECT 1 FROM "order_lines" l JOIN "orders" o ON o."id" = l."orderId"
                 WHERE l."productId" = OLD."id" AND o."commercialState" <> 'DRAFT') OR
                EXISTS (SELECT 1 FROM "poultry_product_sources" WHERE "productId" = OLD."id")) THEN
                RAISE EXCEPTION 'Referenced sales source identity is immutable' USING ERRCODE = '23514';
            END IF;
        END IF;
        IF NEW."kind" = 'PRODUCE' AND NOT EXISTS (
            SELECT 1 FROM "inventory_items" WHERE "organizationId" = NEW."organizationId"
              AND "id" = NEW."inventoryItemId" AND "category" = 'PRODUCE' AND "unit" = NEW."unit"
        ) THEN
            RAISE EXCEPTION 'Produce product requires matching produce item and unit' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF TG_OP = 'UPDATE' AND
           (NEW."id", NEW."organizationId", NEW."productId", NEW."farmId", NEW."flockId", NEW."actorUserId", NEW."createdAt") IS DISTINCT FROM
           (OLD."id", OLD."organizationId", OLD."productId", OLD."farmId", OLD."flockId", OLD."actorUserId", OLD."createdAt") THEN
            RAISE EXCEPTION 'Poultry eligibility identity is immutable' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "sales_products" WHERE "organizationId" = NEW."organizationId"
            AND "id" = NEW."productId" AND "kind" = 'POULTRY') THEN
            RAISE EXCEPTION 'Poultry eligibility requires a poultry product' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "sales_products_validate_definition" BEFORE INSERT OR UPDATE ON "sales_products"
FOR EACH ROW EXECUTE FUNCTION "validate_sales_definition"();
CREATE TRIGGER "poultry_sources_validate_definition" BEFORE INSERT OR UPDATE ON "poultry_product_sources"
FOR EACH ROW EXECUTE FUNCTION "validate_sales_definition"();

CREATE FUNCTION "protect_order_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state "OrderState";
BEGIN
    IF TG_TABLE_NAME = 'orders' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW."commercialState" <> 'DRAFT' THEN
                RAISE EXCEPTION 'Orders start as drafts' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END IF;
        IF (NEW."id", NEW."organizationId", NEW."code", NEW."actorUserId", NEW."createdAt") IS DISTINCT FROM
           (OLD."id", OLD."organizationId", OLD."code", OLD."actorUserId", OLD."createdAt") OR
           NEW."version" <> OLD."version" + 1 THEN
            RAISE EXCEPTION 'Order identity is immutable and version must advance once' USING ERRCODE = '23514';
        END IF;
        IF (OLD."commercialState" = 'CANCELLED' AND NEW."commercialState" <> 'CANCELLED') OR
           (OLD."commercialState" = 'CONFIRMED' AND NEW."commercialState" = 'DRAFT') THEN
            RAISE EXCEPTION 'Order cannot reopen' USING ERRCODE = '23514';
        END IF;
        IF OLD."commercialState" <> 'DRAFT' AND
           (NEW."customerId", NEW."currency", NEW."saleType", NEW."creditTermDays", NEW."customerCode", NEW."customerName",
            NEW."customerContactPerson", NEW."customerPhone", NEW."customerEmail", NEW."customerAddress") IS DISTINCT FROM
           (OLD."customerId", OLD."currency", OLD."saleType", OLD."creditTermDays", OLD."customerCode", OLD."customerName",
            OLD."customerContactPerson", OLD."customerPhone", OLD."customerEmail", OLD."customerAddress") THEN
            RAISE EXCEPTION 'Confirmed commercial snapshot is immutable' USING ERRCODE = '23514';
        END IF;
        IF OLD."commercialState" = 'DRAFT' AND NEW."commercialState" = 'CONFIRMED' THEN
            IF NOT EXISTS (SELECT 1 FROM "order_lines" WHERE "orderId" = NEW."id" AND NOT "isRemoved") OR
               EXISTS (SELECT 1 FROM "order_lines" l JOIN "sales_products" p ON p."id" = l."productId"
                 WHERE l."orderId" = NEW."id" AND NOT l."isRemoved" AND
                 (l."kind", l."unit", l."inventoryItemId") IS DISTINCT FROM (p."kind", p."unit", p."inventoryItemId")) THEN
                RAISE EXCEPTION 'Confirmation requires current nonremoved product snapshots' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSE
        SELECT "commercialState" INTO state FROM "orders"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."orderId" FOR UPDATE;
        IF NOT FOUND OR state <> 'DRAFT' THEN
            RAISE EXCEPTION 'Only draft lines may change' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND
           (NEW."id", NEW."organizationId", NEW."orderId", NEW."lineNumber", NEW."createdAt") IS DISTINCT FROM
           (OLD."id", OLD."organizationId", OLD."orderId", OLD."lineNumber", OLD."createdAt") THEN
            RAISE EXCEPTION 'Stable order line identity cannot change' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "sales_products" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."productId"
            AND ("kind", "unit", "inventoryItemId") IS NOT DISTINCT FROM (NEW."kind", NEW."unit", NEW."inventoryItemId")) THEN
            RAISE EXCEPTION 'Line must snapshot the selected product source identity' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "orders_protect_snapshot" BEFORE INSERT OR UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "protect_order_snapshot"();
CREATE TRIGGER "order_lines_protect_snapshot" BEFORE INSERT OR UPDATE ON "order_lines"
FOR EACH ROW EXECUTE FUNCTION "protect_order_snapshot"();

CREATE FUNCTION "reject_sales_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Sales history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "orders_preserve_history" BEFORE DELETE OR TRUNCATE ON "orders"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "order_lines_preserve_history" BEFORE DELETE OR TRUNCATE ON "order_lines"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "poultry_sources_preserve_history" BEFORE DELETE OR TRUNCATE ON "poultry_product_sources"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "order_events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "order_events"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "fulfilments_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "fulfilments"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "fulfilment_lines_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "fulfilment_lines"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "flock_sale_depletions_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "flock_sale_depletions"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();
CREATE TRIGGER "fulfilment_commands_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "fulfilment_commands"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_sales_history_mutation"();

CREATE FUNCTION "validate_sales_fulfilment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "fulfilments"%ROWTYPE;
BEGIN
    IF NEW."kind" = 'POSTING' AND NOT EXISTS (
        SELECT 1 FROM "orders" WHERE "organizationId" = NEW."organizationId"
          AND "id" = NEW."orderId" AND "commercialState" = 'CONFIRMED'
    ) THEN
        RAISE EXCEPTION 'Posting requires a confirmed order' USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'REVERSAL' THEN
        SELECT * INTO original FROM "fulfilments" WHERE "id" = NEW."reversesFulfilmentId"
          AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId" AND "orderId" = NEW."orderId";
        IF NOT FOUND OR original."kind" <> 'POSTING' THEN
            RAISE EXCEPTION 'Correction requires an original posting in the same scope' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "fulfilments_validate_reversal" BEFORE INSERT ON "fulfilments"
FOR EACH ROW EXECUTE FUNCTION "validate_sales_fulfilment"();

CREATE FUNCTION "validate_sales_allocation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch "fulfilments"%ROWTYPE;
DECLARE demand "order_lines"%ROWTYPE;
DECLARE original "fulfilment_lines"%ROWTYPE;
DECLARE movement "inventory_movements"%ROWTYPE;
BEGIN
    SELECT * INTO batch FROM "fulfilments" WHERE "id" = NEW."fulfilmentId"
      AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId" AND "orderId" = NEW."orderId" FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation requires its scoped batch' USING ERRCODE = '23503'; END IF;
    -- Receipt is inserted last. Once committed, no new allocation can change its result.
    IF EXISTS (SELECT 1 FROM "fulfilment_commands" WHERE "fulfilmentId" = batch."id") THEN
        RAISE EXCEPTION 'Committed batch cannot acquire more allocations' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO demand FROM "order_lines" WHERE "id" = NEW."orderLineId"
      AND "organizationId" = NEW."organizationId" AND "orderId" = NEW."orderId";
    IF NOT FOUND OR demand."isRemoved" OR
       (demand."kind", demand."unit", demand."inventoryItemId") IS DISTINCT FROM (NEW."kind", NEW."unit", NEW."inventoryItemId") OR
       NEW."occurredAt" <> batch."occurredAt" THEN
        RAISE EXCEPTION 'Allocation must match order line source, unit and batch time' USING ERRCODE = '23514';
    END IF;
    IF batch."kind" = 'POSTING' THEN
        IF NEW."reversesLineId" IS NOT NULL THEN RAISE EXCEPTION 'Posting cannot reverse a line' USING ERRCODE = '23514'; END IF;
    ELSE
        SELECT * INTO original FROM "fulfilment_lines" WHERE "id" = NEW."reversesLineId"
          AND "fulfilmentId" = batch."reversesFulfilmentId";
        IF NOT FOUND OR original."reversesLineId" IS NOT NULL OR
           (original."orderLineId", original."kind", original."unit", original."quantity", original."flockId", original."inventoryItemId", original."sourceCode") IS DISTINCT FROM
           (NEW."orderLineId", NEW."kind", NEW."unit", NEW."quantity", NEW."flockId", NEW."inventoryItemId", NEW."sourceCode") THEN
            RAISE EXCEPTION 'Correction must exactly compensate its original allocation' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW."kind" = 'PRODUCE' THEN
        SELECT * INTO movement FROM "inventory_movements" WHERE "id" = NEW."inventoryMovementId"
          AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId" AND "inventoryItemId" = NEW."inventoryItemId" FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Produce movement must exist in scope' USING ERRCODE = '23503'; END IF;
        IF movement."actorUserId" <> batch."actorUserId" OR movement."occurredAt" <> batch."occurredAt" OR
           (batch."kind" = 'POSTING' AND (movement."reason" <> 'ISSUE' OR movement."quantity" <> -NEW."quantity")) OR
           (batch."kind" = 'REVERSAL' AND (movement."reason" <> 'ADJUSTMENT' OR movement."quantity" <> NEW."quantity")) OR
           EXISTS (SELECT 1 FROM "feed_usages" WHERE "inventoryMovementId" = movement."id") THEN
            RAISE EXCEPTION 'Produce allocation must have its own matching signed movement and audit identity' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "fulfilment_lines_validate_allocation" BEFORE INSERT ON "fulfilment_lines"
FOR EACH ROW EXECUTE FUNCTION "validate_sales_allocation"();

CREATE FUNCTION "validate_sale_depletion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation "fulfilment_lines"%ROWTYPE;
DECLARE batch "fulfilments"%ROWTYPE;
DECLARE original "flock_sale_depletions"%ROWTYPE;
BEGIN
    SELECT * INTO allocation FROM "fulfilment_lines" WHERE "id" = NEW."fulfilmentLineId"
      AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId" AND "flockId" = NEW."flockId";
    IF NOT FOUND OR allocation."kind" <> 'POULTRY' THEN
        RAISE EXCEPTION 'Depletion requires a poultry allocation in the same flock' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO batch FROM "fulfilments" WHERE "id" = allocation."fulfilmentId";
    IF allocation."quantity" <> NEW."birdCount" OR batch."actorUserId" <> NEW."actorUserId" OR batch."occurredAt" <> NEW."occurredAt" THEN
        RAISE EXCEPTION 'Depletion must match allocation quantity and audit identity' USING ERRCODE = '23514';
    END IF;
    IF batch."kind" = 'POSTING' THEN
        IF NEW."reversesDepletionId" IS NOT NULL THEN RAISE EXCEPTION 'Posting cannot reverse depletion' USING ERRCODE = '23514'; END IF;
    ELSE
        SELECT * INTO original FROM "flock_sale_depletions" WHERE "id" = NEW."reversesDepletionId"
          AND "fulfilmentLineId" = allocation."reversesLineId";
        IF NOT FOUND OR original."reversesDepletionId" IS NOT NULL OR original."birdCount" <> NEW."birdCount" THEN
            RAISE EXCEPTION 'Depletion correction must compensate its original allocation' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "flock_sale_depletions_validate_link" BEFORE INSERT ON "flock_sale_depletions"
FOR EACH ROW EXECUTE FUNCTION "validate_sale_depletion"();

CREATE FUNCTION "validate_sales_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch "fulfilments"%ROWTYPE;
BEGIN
    SELECT * INTO batch FROM "fulfilments" WHERE "id" = NEW."fulfilmentId"
      AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId" AND "orderId" = NEW."orderId" FOR UPDATE;
    IF NOT FOUND OR NEW."actorUserId" <> batch."actorUserId" OR
       NEW."orderVersion" IS DISTINCT FROM (SELECT "version" FROM "orders" WHERE "id" = NEW."orderId" AND "organizationId" = NEW."organizationId") OR
       (NEW."operation" = 'POST') <> (batch."kind" = 'POSTING') THEN
        RAISE EXCEPTION 'Receipt must identify its committed operation and actor' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "fulfilment_commands_validate_result" BEFORE INSERT ON "fulfilment_commands"
FOR EACH ROW EXECUTE FUNCTION "validate_sales_receipt"();

-- Deferred until commit so a poultry allocation and its ledger can be inserted
-- in either FK-compatible sequence without an artificial cyclic required FK.
CREATE FUNCTION "validate_sales_batch_complete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch "fulfilments"%ROWTYPE;
DECLARE count_lines integer;
BEGIN
    SELECT * INTO batch FROM "fulfilments" WHERE "id" = NEW."id";
    SELECT count(*) INTO count_lines FROM "fulfilment_lines" WHERE "fulfilmentId" = batch."id";
    IF count_lines NOT BETWEEN 1 AND 100 OR
       NOT EXISTS (SELECT 1 FROM "fulfilment_commands" WHERE "fulfilmentId" = batch."id") OR
       EXISTS (SELECT 1 FROM "fulfilment_lines" l LEFT JOIN "flock_sale_depletions" d ON d."fulfilmentLineId" = l."id"
         WHERE l."fulfilmentId" = batch."id" AND l."kind" = 'POULTRY' AND d."id" IS NULL) THEN
        RAISE EXCEPTION 'Committed batch requires allocations, poultry ledgers and a success receipt' USING ERRCODE = '23514';
    END IF;
    IF batch."kind" = 'REVERSAL' AND count_lines <>
       (SELECT count(*) FROM "fulfilment_lines" WHERE "fulfilmentId" = batch."reversesFulfilmentId") THEN
        RAISE EXCEPTION 'Correction must compensate the complete original batch' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "fulfilments_complete_at_commit" AFTER INSERT ON "fulfilments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_sales_batch_complete"();

-- Serialize with the existing M4 movement lock before checking cross-ledger reuse.
-- No existing M3/M4 writer or population calculation is switched by this migration.
CREATE FUNCTION "exclude_sales_feed_movement"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM "inventory_movements" WHERE "id" = NEW."inventoryMovementId" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "fulfilment_lines" WHERE "inventoryMovementId" = NEW."inventoryMovementId") THEN
        RAISE EXCEPTION 'Sales movement cannot be reused for feed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "feed_usages_exclude_sales_movement" BEFORE INSERT ON "feed_usages"
FOR EACH ROW EXECUTE FUNCTION "exclude_sales_feed_movement"();

CREATE FUNCTION "protect_sales_inventory_movement"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "fulfilment_lines" WHERE "inventoryMovementId" = OLD."id") THEN
        RAISE EXCEPTION 'Sales-linked inventory history is append-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "inventory_movements_protect_sales_link" BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "protect_sales_inventory_movement"();

COMMIT;
