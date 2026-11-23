-- M6-05 audit remediation. Existing transfers predate receiving-account
-- capture, so preserve them under a conservative legacy evidence identity.
ALTER TABLE "payments"
  ADD COLUMN "receivingAccount" VARCHAR(200),
  ALTER COLUMN "evidenceKey" TYPE VARCHAR(500);

DROP INDEX "payments_organizationId_method_evidenceKey_key";
ALTER TABLE "payments" DISABLE TRIGGER payments_append_only;
UPDATE "payments"
SET "evidenceKey" = CASE
  WHEN "method" = 'CASH' THEN 'CASH:' || lower(regexp_replace(btrim("cashReceiptNumber"), '[[:space:]]+', '', 'g'))
  ELSE 'BANK-LEGACY:' || lower(regexp_replace(btrim("bankTransferReference"), '[[:space:]]+', '', 'g'))
END;
ALTER TABLE "payments" ENABLE TRIGGER payments_append_only;
CREATE UNIQUE INDEX "payments_organizationId_method_evidenceKey_key"
  ON "payments"("organizationId", "method", "evidenceKey");

CREATE OR REPLACE FUNCTION canonical_payment_evidence(
  method "PaymentMethod",
  cash_receipt text,
  receiving_account text,
  transfer_reference text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE receipt_key text; account_key text; reference_key text;
BEGIN
  IF method = 'CASH' THEN
    receipt_key := lower(regexp_replace(btrim(COALESCE(cash_receipt, '')), '[[:space:]]+', '', 'g'));
    IF receipt_key = '' THEN RAISE EXCEPTION 'cash receipt evidence is empty' USING ERRCODE = '23514'; END IF;
    RETURN 'CASH:' || receipt_key;
  END IF;
  account_key := lower(regexp_replace(btrim(COALESCE(receiving_account, '')), '[[:space:]]+', '', 'g'));
  reference_key := lower(regexp_replace(btrim(COALESCE(transfer_reference, '')), '[[:space:]]+', '', 'g'));
  IF account_key = '' OR reference_key = '' THEN
    RAISE EXCEPTION 'bank transfer receiving account and reference are required' USING ERRCODE = '23514';
  END IF;
  RETURN 'BANK:' || length(account_key)::text || ':' || account_key || ':' || reference_key;
END;
$$;

CREATE OR REPLACE FUNCTION validate_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_key text;
BEGIN
  IF NEW."method" = 'BANK_TRANSFER' THEN
    -- Legacy rows remain readable; new transfers must name the receiving account.
    IF NEW."receivingAccount" IS NULL THEN
      RAISE EXCEPTION 'bank transfer receiving account is required' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "payments" existing
      WHERE existing."organizationId" = NEW."organizationId"
        AND existing."method" = 'BANK_TRANSFER'
        AND existing."receivingAccount" IS NULL
        AND lower(regexp_replace(btrim(existing."bankTransferReference"), '[[:space:]]+', '', 'g')) =
          lower(regexp_replace(btrim(NEW."bankTransferReference"), '[[:space:]]+', '', 'g'))
    ) THEN
      -- Reuse the legacy unique identity so PostgreSQL's unique index reports
      -- this as the normal evidence duplicate to both SQL and Prisma clients.
      expected_key := 'BANK-LEGACY:' || lower(regexp_replace(btrim(NEW."bankTransferReference"), '[[:space:]]+', '', 'g'));
    ELSE
      expected_key := canonical_payment_evidence(
        NEW."method", NEW."cashReceiptNumber", NEW."receivingAccount", NEW."bankTransferReference"
      );
    END IF;
  ELSE
    expected_key := canonical_payment_evidence(
      NEW."method", NEW."cashReceiptNumber", NEW."receivingAccount", NEW."bankTransferReference"
    );
  END IF;
  IF expected_key LIKE 'BANK-LEGACY:%' THEN
    NEW."evidenceKey" := expected_key;
    RETURN NEW;
  END IF;
  IF NEW."evidenceKey" <> expected_key THEN
    RAISE EXCEPTION 'payment evidence key does not match canonical evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_evidence_validate BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION validate_payment_evidence();

-- Same-organization row locking in the payment command path also serializes
-- direct inserts through the triggers installed by M6-05.
CREATE OR REPLACE FUNCTION validate_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_state text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payment_lifecycle_events" e
    WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='VERIFIED'
  ) THEN
    RAISE EXCEPTION 'only verified payments may be allocated' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "payment_lifecycle_events" e
    WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='REVERSED'
  ) THEN
    RAISE EXCEPTION 'reversed payment cannot be allocated' USING ERRCODE = '23514';
  END IF;
  SELECT i."status"::text INTO invoice_state FROM "invoices" i
    WHERE i."organizationId"=NEW."organizationId" AND i."id"=NEW."invoiceId";
  IF NOT FOUND OR invoice_state <> 'ISSUED' THEN
    RAISE EXCEPTION 'payment allocations require an issued invoice' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
