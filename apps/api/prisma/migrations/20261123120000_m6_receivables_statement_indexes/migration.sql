CREATE INDEX "invoices_organizationId_dueAt_id_idx"
ON "invoices"("organizationId", "dueAt", "id");

CREATE INDEX "invoices_organizationId_customerId_dueAt_id_idx"
ON "invoices"("organizationId", "customerId", "dueAt", "id");

CREATE INDEX "payment_allocations_organizationId_customerId_createdAt_id_idx"
ON "payment_allocations"("organizationId", "customerId", "createdAt", "id");
