-- CreateTable
CREATE TABLE "flocks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birdType" TEXT,
    "placementDate" DATE NOT NULL,
    "startingBirdCount" INTEGER NOT NULL,
    "expectedMaturityDate" DATE,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flocks_pkey" PRIMARY KEY ("id")
);

-- Placement population is the positive integer baseline for derived live population.
ALTER TABLE "flocks" ADD CONSTRAINT "flocks_startingBirdCount_positive_check"
CHECK ("startingBirdCount" > 0);

-- Maturity is an optional calendar date, never before placement.
ALTER TABLE "flocks" ADD CONSTRAINT "flocks_expectedMaturityDate_check"
CHECK ("expectedMaturityDate" IS NULL OR "expectedMaturityDate" >= "placementDate");

-- CreateIndex
CREATE INDEX "flocks_organizationId_farmId_isActive_idx" ON "flocks"("organizationId", "farmId", "isActive");

-- CreateIndex
CREATE INDEX "flocks_organizationId_farmId_placementDate_idx" ON "flocks"("organizationId", "farmId", "placementDate");

-- CreateIndex
CREATE UNIQUE INDEX "flocks_organizationId_farmId_id_key" ON "flocks"("organizationId", "farmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "flocks_organizationId_code_key" ON "flocks"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "flocks" ADD CONSTRAINT "flocks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "flocks" ADD CONSTRAINT "flocks_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
