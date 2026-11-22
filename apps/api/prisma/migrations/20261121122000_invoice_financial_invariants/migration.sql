-- Immutable, auditable financial history. Revisions require compensating records.
CREATE FUNCTION reject_invoice_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issued invoice history is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();
CREATE TRIGGER invoice_lines_immutable BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();
CREATE TRIGGER invoice_events_immutable BEFORE UPDATE OR DELETE ON invoice_lifecycle_events FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();
CREATE TRIGGER invoice_allocations_immutable BEFORE UPDATE OR DELETE ON invoice_fulfilment_allocations FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();
CREATE TRIGGER invoice_commands_immutable BEFORE UPDATE OR DELETE ON invoice_issue_commands FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();
CREATE TRIGGER invoice_sequence_no_delete BEFORE DELETE ON invoice_sequences FOR EACH ROW EXECUTE FUNCTION reject_invoice_mutation();

CREATE FUNCTION reject_invoice_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoice ledger truncation is forbidden' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION reject_invoice_truncate();
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION reject_invoice_truncate();
CREATE TRIGGER invoice_events_no_truncate BEFORE TRUNCATE ON invoice_lifecycle_events FOR EACH STATEMENT EXECUTE FUNCTION reject_invoice_truncate();
CREATE TRIGGER invoice_allocations_no_truncate BEFORE TRUNCATE ON invoice_fulfilment_allocations FOR EACH STATEMENT EXECUTE FUNCTION reject_invoice_truncate();
CREATE TRIGGER invoice_commands_no_truncate BEFORE TRUNCATE ON invoice_issue_commands FOR EACH STATEMENT EXECUTE FUNCTION reject_invoice_truncate();

CREATE FUNCTION prevent_invoice_sequence_rewind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."nextNumber" < OLD."nextNumber" OR NEW."nextNumber" < 1 THEN
    RAISE EXCEPTION 'invoice number sequence cannot be rewound' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_sequence_monotonic BEFORE UPDATE ON invoice_sequences FOR EACH ROW EXECUTE FUNCTION prevent_invoice_sequence_rewind();

-- Deferred reconciliation permits invoice, lines, allocations, event, and receipt
-- to be inserted in any order within the one financial transaction, but nothing partial can commit.
CREATE FUNCTION assert_invoice_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key uuid; invoice_org uuid; source_order uuid;
BEGIN
  invoice_key := COALESCE((to_jsonb(NEW)->>'invoiceId')::uuid, (to_jsonb(NEW)->>'id')::uuid);
  invoice_org := NEW."organizationId";
  SELECT "orderId" INTO source_order FROM invoices WHERE "organizationId"=invoice_org AND "id"=invoice_key;
  IF source_order IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM orders WHERE "organizationId"=invoice_org AND "id"=source_order FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM invoices i JOIN fulfilments f ON f."organizationId"=i."organizationId" AND f."farmId"=i."farmId" AND f."orderId"=i."orderId" AND f."id"=i."fulfilmentId"
    JOIN fulfilment_commands fc ON fc."organizationId"=i."organizationId" AND fc."farmId"=i."farmId" AND fc."orderId"=i."orderId" AND fc."fulfilmentId"=i."fulfilmentId" AND fc."operation"='POST'
    JOIN invoice_issue_commands ic ON ic."organizationId"=i."organizationId" AND ic."fulfilmentId"=i."fulfilmentId" AND ic."invoiceId"=i."id"
    WHERE i."organizationId"=invoice_org AND i."id"=invoice_key AND f."kind"='POSTING'
      AND i."status"='ISSUED' AND i."taxTreatmentStatus"='APPROVED_POLICY_NOT_CALCULATED'
      AND length(trim(i."taxPolicyReference"))>0 AND length(trim(i."taxPolicyVersion"))>0
      AND ic."actorMembershipId"=i."issuedByMembershipId"
      AND (SELECT count(*) FROM invoice_lines l WHERE l."organizationId"=i."organizationId" AND l."invoiceId"=i."id") =
          (SELECT count(*) FROM fulfilment_lines fl WHERE fl."organizationId"=i."organizationId" AND fl."fulfilmentId"=i."fulfilmentId" AND fl."reversesLineId" IS NULL)
      AND (SELECT count(*) FROM invoice_fulfilment_allocations a WHERE a."organizationId"=i."organizationId" AND a."invoiceId"=i."id") =
          (SELECT count(*) FROM fulfilment_lines fl WHERE fl."organizationId"=i."organizationId" AND fl."fulfilmentId"=i."fulfilmentId" AND fl."reversesLineId" IS NULL)
      AND COALESCE((SELECT sum(l."lineAmount") FROM invoice_lines l WHERE l."organizationId"=i."organizationId" AND l."invoiceId"=i."id"),0)=i."grossAmount"
      AND NOT EXISTS (
        SELECT 1 FROM fulfilment_lines fl
        LEFT JOIN invoice_lines l ON l."organizationId"=fl."organizationId" AND l."fulfilmentLineId"=fl."id"
        LEFT JOIN invoice_fulfilment_allocations a ON a."organizationId"=fl."organizationId" AND a."fulfilmentLineId"=fl."id" AND a."invoiceId"=i."id"
        LEFT JOIN order_lines ol ON ol."organizationId"=fl."organizationId" AND ol."orderId"=fl."orderId" AND ol."id"=fl."orderLineId"
        WHERE fl."organizationId"=i."organizationId" AND fl."fulfilmentId"=i."fulfilmentId" AND fl."reversesLineId" IS NULL
          AND (l."id" IS NULL OR a."fulfilmentLineId" IS NULL OR l."quantity"<>fl."quantity" OR l."unit"<>fl."unit" OR l."unitPrice"<>ol."unitPrice" OR l."lineAmount"<>round(fl."quantity"*ol."unitPrice",2))
      )
  ) THEN RAISE EXCEPTION 'invoice does not reconcile to committed fulfilment' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER invoice_reconciles_posting AFTER INSERT ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_complete();
CREATE CONSTRAINT TRIGGER invoice_line_reconciles_posting AFTER INSERT ON invoice_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_complete();
CREATE CONSTRAINT TRIGGER invoice_allocation_reconciles_posting AFTER INSERT ON invoice_fulfilment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_complete();
CREATE CONSTRAINT TRIGGER invoice_event_reconciles_posting AFTER INSERT ON invoice_lifecycle_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_complete();
CREATE CONSTRAINT TRIGGER invoice_command_reconciles_posting AFTER INSERT ON invoice_issue_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_complete();

-- The same order lock serializes reversal with issuance. This database guard also
-- prevents an alternate writer from reversing a billed physical posting.
CREATE FUNCTION reject_invoiced_fulfilment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind"='REVERSAL' THEN
    PERFORM 1 FROM orders WHERE "organizationId"=NEW."organizationId" AND "id"=NEW."orderId" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM invoices i WHERE i."organizationId"=NEW."organizationId" AND i."fulfilmentId"=NEW."reversesFulfilmentId") THEN
      RAISE EXCEPTION 'invoiced fulfilment reversal requires a credit note' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoiced_fulfilment_reversal_guard BEFORE INSERT ON fulfilments FOR EACH ROW EXECUTE FUNCTION reject_invoiced_fulfilment_reversal();