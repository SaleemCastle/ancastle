-- Preserve JMD cents while covering the maximum amount implied by M5 limits:
-- 15 integer digits of quantity x 15 integer digits of unit price, then 100 lines.
ALTER TABLE "invoice_lines"
  ALTER COLUMN "lineAmount" TYPE DECIMAL(34,2)
  USING "lineAmount"::DECIMAL(34,2);

ALTER TABLE "invoices"
  ALTER COLUMN "grossAmount" TYPE DECIMAL(34,2)
  USING "grossAmount"::DECIMAL(34,2);
