-- CreateTable
CREATE TABLE "farm_access_assignments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_access_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_access_assignments_organizationId_membershipId_isActiv_idx" ON "farm_access_assignments"("organizationId", "membershipId", "isActive");

-- CreateIndex
CREATE INDEX "farm_access_assignments_organizationId_farmId_idx" ON "farm_access_assignments"("organizationId", "farmId");

-- CreateIndex
CREATE UNIQUE INDEX "farm_access_assignments_membershipId_farmId_key" ON "farm_access_assignments"("membershipId", "farmId");

-- CreateIndex
CREATE UNIQUE INDEX "farms_organizationId_id_key" ON "farms"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_id_key" ON "organization_memberships"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "farm_access_assignments" ADD CONSTRAINT "farm_access_assignments_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "farm_access_assignments" ADD CONSTRAINT "farm_access_assignments_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
