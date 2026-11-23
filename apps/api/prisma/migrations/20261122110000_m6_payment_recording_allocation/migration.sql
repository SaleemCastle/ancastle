CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');
CREATE TYPE "PaymentLifecycleType" AS ENUM ('RECORDED', 'VERIFIED', 'REVERSED');
CREATE TYPE "PaymentCommandType" AS ENUM ('RECORD', 'VERIFY', 'ALLOCATE', 'REVERSE');

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_organizationId_id_customerId_currency_key"
  UNIQUE ("organizationId", "id", "customerId", "currency");

CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "amount" DECIMAL(34,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'JMD',
  "method" "PaymentMethod" NOT NULL,
  "cashReceiptNumber" VARCHAR(200),
  "bankTransferReference" VARCHAR(200),
  "evidenceKey" VARCHAR(200) NOT NULL,
  "recordedByMembershipId" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "payments_currency_jmd_check" CHECK ("currency" = 'JMD'),
  CONSTRAINT "payments_evidence_method_check" CHECK (
    ("method"='CASH' AND length(btrim(COALESCE("cashReceiptNumber",'')))>0 AND "bankTransferReference" IS NULL)
    OR ("method"='BANK_TRANSFER' AND length(btrim(COALESCE("bankTransferReference",'')))>0 AND "cashReceiptNumber" IS NULL)
  ),
  CONSTRAINT "payments_evidence_key_nonempty_check" CHECK (length("evidenceKey") > 0)
);
CREATE UNIQUE INDEX "payments_organizationId_id_key" ON "payments"("organizationId", "id");
CREATE UNIQUE INDEX "payments_organizationId_id_customerId_currency_key" ON "payments"("organizationId", "id", "customerId", "currency");
CREATE UNIQUE INDEX "payments_organizationId_method_evidenceKey_key" ON "payments"("organizationId", "method", "evidenceKey");
CREATE INDEX "payments_organizationId_customerId_recordedAt_id_idx" ON "payments"("organizationId", "customerId", "recordedAt", "id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_customerId_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_recordedByMembershipId_fkey"
  FOREIGN KEY ("organizationId", "recordedByMembershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_lifecycle_events" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "type" "PaymentLifecycleType" NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "reason" VARCHAR(500),
  "selfVerification" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_lifecycle_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_lifecycle_events_self_verification_check" CHECK ("type" = 'VERIFIED' OR NOT "selfVerification"),
  CONSTRAINT "payment_lifecycle_events_reason_check" CHECK ("type" <> 'REVERSED' OR length(btrim(COALESCE("reason", ''))) > 0)
);
CREATE UNIQUE INDEX "payment_lifecycle_events_organizationId_paymentId_id_key" ON "payment_lifecycle_events"("organizationId", "paymentId", "id");
CREATE UNIQUE INDEX "payment_lifecycle_events_organizationId_paymentId_type_key" ON "payment_lifecycle_events"("organizationId", "paymentId", "type");
CREATE INDEX "payment_lifecycle_events_organizationId_paymentId_createdAt_idx" ON "payment_lifecycle_events"("organizationId", "paymentId", "createdAt", "id");
ALTER TABLE "payment_lifecycle_events" ADD CONSTRAINT "payment_lifecycle_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_lifecycle_events" ADD CONSTRAINT "payment_lifecycle_events_organizationId_paymentId_fkey"
  FOREIGN KEY ("organizationId", "paymentId") REFERENCES "payments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_lifecycle_events" ADD CONSTRAINT "payment_lifecycle_events_organizationId_actorMembershipId_fkey"
  FOREIGN KEY ("organizationId", "actorMembershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_allocations" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(34,2) NOT NULL,
  "allocatedByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_allocations_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_allocations_currency_jmd_check" CHECK ("currency" = 'JMD')
);
CREATE UNIQUE INDEX "payment_allocations_organizationId_id_key" ON "payment_allocations"("organizationId", "id");
CREATE UNIQUE INDEX "payment_allocations_organizationId_paymentId_id_key" ON "payment_allocations"("organizationId", "paymentId", "id");
CREATE UNIQUE INDEX "payment_allocations_organizationId_paymentId_invoiceId_id_key" ON "payment_allocations"("organizationId", "paymentId", "invoiceId", "id");
CREATE INDEX "payment_allocations_organizationId_paymentId_createdAt_id_idx" ON "payment_allocations"("organizationId", "paymentId", "createdAt", "id");
CREATE INDEX "payment_allocations_organizationId_invoiceId_createdAt_id_idx" ON "payment_allocations"("organizationId", "invoiceId", "createdAt", "id");
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organizationId_paymentId_customerId_cu_fkey"
  FOREIGN KEY ("organizationId", "paymentId", "customerId", "currency") REFERENCES "payments"("organizationId", "id", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organizationId_invoiceId_customerId_cu_fkey"
  FOREIGN KEY ("organizationId", "invoiceId", "customerId", "currency") REFERENCES "invoices"("organizationId", "id", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organizationId_allocatedByMembershipId_fkey"
  FOREIGN KEY ("organizationId", "allocatedByMembershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_allocation_reversals" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "allocationId" UUID NOT NULL,
  "amount" DECIMAL(34,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_allocation_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_allocation_reversals_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_allocation_reversals_reason_check" CHECK (length(btrim("reason")) > 0)
);
CREATE UNIQUE INDEX "payment_allocation_reversals_organizationId_allocationId_key" ON "payment_allocation_reversals"("organizationId", "allocationId");
CREATE INDEX "payment_allocation_reversals_organizationId_paymentId_creat_idx" ON "payment_allocation_reversals"("organizationId", "paymentId", "createdAt", "id");
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_organizationId_paymentId_fkey"
  FOREIGN KEY ("organizationId", "paymentId") REFERENCES "payments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_organizationId_paymentId_allo_fkey"
  FOREIGN KEY ("organizationId", "paymentId", "allocationId") REFERENCES "payment_allocations"("organizationId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_organizationId_actorMembershi_fkey"
  FOREIGN KEY ("organizationId", "actorMembershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_command_receipts" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "key" UUID NOT NULL,
  "type" "PaymentCommandType" NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "paymentId" UUID NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_command_receipts_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "payment_command_receipts_organizationId_key_key" ON "payment_command_receipts"("organizationId", "key");
CREATE INDEX "payment_command_receipts_organizationId_paymentId_createdAt_idx" ON "payment_command_receipts"("organizationId", "paymentId", "createdAt");
ALTER TABLE "payment_command_receipts" ADD CONSTRAINT "payment_command_receipts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_command_receipts" ADD CONSTRAINT "payment_command_receipts_organizationId_paymentId_fkey"
  FOREIGN KEY ("organizationId", "paymentId") REFERENCES "payments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_command_receipts" ADD CONSTRAINT "payment_command_receipts_organizationId_actorMembershipId_fkey"
  FOREIGN KEY ("organizationId", "actorMembershipId") REFERENCES "organization_memberships"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial history is append-only at the database boundary.
CREATE FUNCTION reject_payment_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment ledger history is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "payment_lifecycle_events" FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
CREATE TRIGGER payment_allocation_reversals_append_only BEFORE UPDATE OR DELETE ON "payment_allocation_reversals" FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();
CREATE TRIGGER payment_commands_append_only BEFORE UPDATE OR DELETE ON "payment_command_receipts" FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation();

CREATE FUNCTION reject_payment_ledger_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment ledger truncation is forbidden' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON "payments" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_truncate();
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON "payment_lifecycle_events" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_truncate();
CREATE TRIGGER payment_allocations_no_truncate BEFORE TRUNCATE ON "payment_allocations" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_truncate();
CREATE TRIGGER payment_allocation_reversals_no_truncate BEFORE TRUNCATE ON "payment_allocation_reversals" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_truncate();
CREATE TRIGGER payment_commands_no_truncate BEFORE TRUNCATE ON "payment_command_receipts" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_truncate();

-- Database writers share the tenant serialization point used by the service.
CREATE FUNCTION lock_payment_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "organizations" WHERE "id"=NEW."organizationId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment organization was not found' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_org_lock BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION lock_payment_organization();
CREATE TRIGGER payment_events_org_lock BEFORE INSERT ON "payment_lifecycle_events" FOR EACH ROW EXECUTE FUNCTION lock_payment_organization();
CREATE TRIGGER payment_allocations_org_lock BEFORE INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION lock_payment_organization();
CREATE TRIGGER payment_allocation_reversals_org_lock BEFORE INSERT ON "payment_allocation_reversals" FOR EACH ROW EXECUTE FUNCTION lock_payment_organization();

CREATE FUNCTION validate_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recorded_by uuid;
BEGIN
  SELECT "recordedByMembershipId" INTO recorded_by FROM "payments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."paymentId";
  IF NOT FOUND THEN RAISE EXCEPTION 'payment event requires a payment' USING ERRCODE = '23503'; END IF;
  IF NEW."type" = 'RECORDED' THEN
    IF NEW."actorMembershipId" <> recorded_by OR NEW."selfVerification" THEN
      RAISE EXCEPTION 'recorded event actor does not match payment recorder' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."type" = 'VERIFIED' THEN
    IF NEW."selfVerification" <> (NEW."actorMembershipId" = recorded_by) THEN
      RAISE EXCEPTION 'self verification audit flag is inconsistent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."type" = 'REVERSED' AND length(btrim(COALESCE(NEW."reason", ''))) = 0 THEN
    RAISE EXCEPTION 'payment reversal requires a reason' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='REVERSED') THEN
    RAISE EXCEPTION 'reversed payment cannot transition again' USING ERRCODE = '23514';
  END IF;
  IF NEW."type"='VERIFIED' AND EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='VERIFIED') THEN
    RAISE EXCEPTION 'payment is already verified' USING ERRCODE = '23514';
  END IF;
  IF NEW."type"='REVERSED' AND EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='REVERSED') THEN
    RAISE EXCEPTION 'payment is already reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_event_validate BEFORE INSERT ON "payment_lifecycle_events" FOR EACH ROW EXECUTE FUNCTION validate_payment_event();

CREATE FUNCTION validate_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='VERIFIED') THEN
    RAISE EXCEPTION 'only verified payments may be allocated' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=NEW."organizationId" AND e."paymentId"=NEW."paymentId" AND e."type"='REVERSED') THEN
    RAISE EXCEPTION 'reversed payment cannot be allocated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocation_validate BEFORE INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation();

CREATE FUNCTION validate_payment_allocation_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation_amount decimal(34,2);
BEGIN
  SELECT "amount" INTO allocation_amount FROM "payment_allocations"
    WHERE "organizationId"=NEW."organizationId" AND "paymentId"=NEW."paymentId" AND "id"=NEW."allocationId";
  IF NOT FOUND OR allocation_amount <> NEW."amount" THEN
    RAISE EXCEPTION 'allocation reversal must fully reverse its allocation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocation_reversal_validate BEFORE INSERT ON "payment_allocation_reversals" FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation_reversal();

-- Deferred guards observe the complete transaction and independently enforce
-- amount conservation, invoice capacity, verified funds, and complete reversal.
CREATE FUNCTION assert_payment_ledger_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id uuid; payment_id uuid; invoice_id uuid; payment_amount decimal(34,2); payment_reversed boolean;
DECLARE active_payment_allocations decimal(34,2); active_invoice_allocations decimal(34,2); invoice_gross decimal(34,2);
BEGIN
  org_id := NEW."organizationId";
  payment_id := COALESCE((to_jsonb(NEW)->>'paymentId')::uuid, (to_jsonb(NEW)->>'id')::uuid);
  invoice_id := (to_jsonb(NEW)->>'invoiceId')::uuid;
  IF invoice_id IS NULL AND TG_TABLE_NAME='payment_allocation_reversals' THEN
    SELECT a."invoiceId" INTO invoice_id FROM "payment_allocations" a WHERE a."organizationId"=org_id AND a."paymentId"=payment_id AND a."id"=(to_jsonb(NEW)->>'allocationId')::uuid;
  END IF;
  SELECT "amount" INTO payment_amount FROM "payments" WHERE "organizationId"=org_id AND "id"=payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=org_id AND e."paymentId"=payment_id AND e."type"='RECORDED') THEN
    RAISE EXCEPTION 'payment requires a recorded lifecycle event' USING ERRCODE = '23514';
  END IF;
  payment_reversed := EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=org_id AND e."paymentId"=payment_id AND e."type"='REVERSED');
  SELECT COALESCE(sum(a."amount"-COALESCE(r."amount",0)),0) INTO active_payment_allocations
    FROM "payment_allocations" a LEFT JOIN "payment_allocation_reversals" r ON r."organizationId"=a."organizationId" AND r."allocationId"=a."id"
    WHERE a."organizationId"=org_id AND a."paymentId"=payment_id;
  IF active_payment_allocations < 0 OR active_payment_allocations > payment_amount THEN
    RAISE EXCEPTION 'active allocations exceed verified payment funds' USING ERRCODE = '23514';
  END IF;
  IF active_payment_allocations > 0 AND NOT EXISTS (SELECT 1 FROM "payment_lifecycle_events" e WHERE e."organizationId"=org_id AND e."paymentId"=payment_id AND e."type"='VERIFIED') THEN
    RAISE EXCEPTION 'unverified payment has active allocations' USING ERRCODE = '23514';
  END IF;
  IF payment_reversed AND active_payment_allocations <> 0 THEN
    RAISE EXCEPTION 'reversed payment retains active allocations' USING ERRCODE = '23514';
  END IF;
  IF payment_reversed AND EXISTS (
    SELECT 1 FROM "payment_allocations" a LEFT JOIN "payment_allocation_reversals" r ON r."organizationId"=a."organizationId" AND r."allocationId"=a."id"
    WHERE a."organizationId"=org_id AND a."paymentId"=payment_id AND r."id" IS NULL
  ) THEN RAISE EXCEPTION 'payment reversal must unwind all allocations' USING ERRCODE = '23514'; END IF;
  IF invoice_id IS NOT NULL THEN
    SELECT "grossAmount" INTO invoice_gross FROM "invoices" WHERE "organizationId"=org_id AND "id"=invoice_id;
    IF FOUND THEN
      SELECT COALESCE(sum(a."amount"-COALESCE(r."amount",0)),0) INTO active_invoice_allocations
        FROM "payment_allocations" a LEFT JOIN "payment_allocation_reversals" r ON r."organizationId"=a."organizationId" AND r."allocationId"=a."id"
        WHERE a."organizationId"=org_id AND a."invoiceId"=invoice_id;
      IF active_invoice_allocations < 0 OR active_invoice_allocations > invoice_gross THEN
        RAISE EXCEPTION 'active allocations exceed invoice outstanding capacity' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER payment_balance_after_payment AFTER INSERT ON "payments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_payment_ledger_consistent();
CREATE CONSTRAINT TRIGGER payment_balance_after_event AFTER INSERT ON "payment_lifecycle_events" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_payment_ledger_consistent();
CREATE CONSTRAINT TRIGGER payment_balance_after_allocation AFTER INSERT ON "payment_allocations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_payment_ledger_consistent();
CREATE CONSTRAINT TRIGGER payment_balance_after_allocation_reversal AFTER INSERT ON "payment_allocation_reversals" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_payment_ledger_consistent();
