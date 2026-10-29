-- CreateEnum
CREATE TYPE "InventoryMovementReason" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "reason" "InventoryMovementReason" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- Inventory movements must always change stock.
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_quantity_nonzero_check"
CHECK ("quantity" <> 0);

-- Keep free-form ledger metadata bounded.
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_note_length_check"
CHECK ("note" IS NULL OR char_length("note") <= 2000);

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_reference_length_check"
CHECK ("reference" IS NULL OR char_length("reference") <= 120);

-- CreateIndex
CREATE INDEX "inventory_movements_organizationId_farmId_inventoryItemId_o_idx" ON "inventory_movements"("organizationId", "farmId", "inventoryItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "inventory_movements_organizationId_inventoryItemId_idx" ON "inventory_movements"("organizationId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_movements_actorUserId_idx" ON "inventory_movements"("actorUserId");

-- CreateIndex
CREATE INDEX "inventory_movements_organizationId_occurredAt_idx" ON "inventory_movements"("organizationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organizationId_inventoryItemId_fkey" FOREIGN KEY ("organizationId", "inventoryItemId") REFERENCES "inventory_items"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
