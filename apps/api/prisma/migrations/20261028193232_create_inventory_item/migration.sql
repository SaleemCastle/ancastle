-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('EACH', 'KG', 'G', 'L', 'ML');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('FEED', 'VITAMIN', 'PRODUCE', 'SUPPLY', 'OTHER');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "InventoryUnit" NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "lowStockThreshold" DECIMAL(18,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- Prevent invalid negative low-stock thresholds
ALTER TABLE "inventory_items"
ADD CONSTRAINT "inventory_items_lowStockThreshold_check"
CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

-- CreateIndex
CREATE INDEX "inventory_items_organizationId_idx" ON "inventory_items"("organizationId");

-- CreateIndex
CREATE INDEX "inventory_items_organizationId_isActive_idx" ON "inventory_items"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "inventory_items_organizationId_category_idx" ON "inventory_items"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_organizationId_id_key" ON "inventory_items"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_organizationId_code_key" ON "inventory_items"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
