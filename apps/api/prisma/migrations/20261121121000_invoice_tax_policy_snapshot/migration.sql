ALTER TABLE "invoices" ADD COLUMN "customerBillingSnapshot" JSONB NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "paymentTermsSnapshot" JSONB NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "taxPolicyReference" TEXT;
ALTER TABLE "invoices" ADD COLUMN "taxPolicyVersion" TEXT;
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_nextNumber_positive" CHECK ("nextNumber" > 0);