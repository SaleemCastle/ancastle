-- Issuance and reversal serialize on the order row. A deferred invoice check
-- waits for concurrent reversals and rejects an invoice if reversal committed.
-- The existing reversal trigger takes the same order lock before checking invoices.

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_currency_jmd_check" CHECK ("currency" = 'JMD');

CREATE UNIQUE INDEX "invoice_lifecycle_events_one_issued_uq"
  ON "invoice_lifecycle_events" ("organizationId", "invoiceId")
  WHERE "type" = 'ISSUED';

CREATE OR REPLACE FUNCTION assert_invoice_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key uuid; invoice_org uuid; source_order uuid;
BEGIN
  invoice_key := COALESCE((to_jsonb(NEW)->>'invoiceId')::uuid, (to_jsonb(NEW)->>'id')::uuid);
  invoice_org := NEW."organizationId";
  SELECT "orderId" INTO source_order
    FROM invoices
    WHERE "organizationId" = invoice_org AND "id" = invoice_key;
  IF source_order IS NULL THEN RETURN NULL; END IF;

  -- This row lock is shared with M5 reversal. Under READ COMMITTED, the
  -- following checks observe whichever competing transaction committed first.
  PERFORM 1 FROM orders
    WHERE "organizationId" = invoice_org AND "id" = source_order
    FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM invoices i
    JOIN orders o
      ON o."organizationId" = i."organizationId"
     AND o."id" = i."orderId"
     AND o."customerId" = i."customerId"
     AND o."currency" = i."currency"
    JOIN fulfilments f
      ON f."organizationId" = i."organizationId"
     AND f."farmId" = i."farmId"
     AND f."orderId" = i."orderId"
     AND f."id" = i."fulfilmentId"
     AND f."kind" = 'POSTING'
    JOIN fulfilment_commands fc
      ON fc."organizationId" = i."organizationId"
     AND fc."farmId" = i."farmId"
     AND fc."orderId" = i."orderId"
     AND fc."fulfilmentId" = i."fulfilmentId"
     AND fc."operation" = 'POST'
    JOIN invoice_issue_commands ic
      ON ic."organizationId" = i."organizationId"
     AND ic."fulfilmentId" = i."fulfilmentId"
     AND ic."invoiceId" = i."id"
    WHERE i."organizationId" = invoice_org
      AND i."id" = invoice_key
      AND i."status" = 'ISSUED'
      AND i."currency" = 'JMD'
      AND i."taxTreatmentStatus" = 'APPROVED_POLICY_NOT_CALCULATED'
      AND length(trim(i."taxPolicyReference")) > 0
      AND length(trim(i."taxPolicyVersion")) > 0
      AND ic."actorMembershipId" = i."issuedByMembershipId"
      AND NOT EXISTS (
        SELECT 1 FROM fulfilments reversal
        WHERE reversal."organizationId" = i."organizationId"
          AND reversal."farmId" = i."farmId"
          AND reversal."orderId" = i."orderId"
          AND reversal."kind" = 'REVERSAL'
          AND reversal."reversesFulfilmentId" = i."fulfilmentId"
      )
      AND (
        SELECT count(*) FROM invoice_lifecycle_events e
        WHERE e."organizationId" = i."organizationId"
          AND e."invoiceId" = i."id"
          AND e."type" = 'ISSUED'
          AND e."actorMembershipId" = i."issuedByMembershipId"
      ) = 1
      AND (
        SELECT count(*) FROM invoice_lines l
        WHERE l."organizationId" = i."organizationId" AND l."invoiceId" = i."id"
      ) = (
        SELECT count(*) FROM fulfilment_lines fl
        WHERE fl."organizationId" = i."organizationId"
          AND fl."fulfilmentId" = i."fulfilmentId"
          AND fl."reversesLineId" IS NULL
      )
      AND (
        SELECT count(*) FROM invoice_fulfilment_allocations a
        WHERE a."organizationId" = i."organizationId" AND a."invoiceId" = i."id"
      ) = (
        SELECT count(*) FROM fulfilment_lines fl
        WHERE fl."organizationId" = i."organizationId"
          AND fl."fulfilmentId" = i."fulfilmentId"
          AND fl."reversesLineId" IS NULL
      )
      AND COALESCE((
        SELECT sum(l."lineAmount") FROM invoice_lines l
        WHERE l."organizationId" = i."organizationId" AND l."invoiceId" = i."id"
      ), 0) = i."grossAmount"
      AND NOT EXISTS (
        SELECT 1
        FROM fulfilment_lines fl
        LEFT JOIN invoice_lines l
          ON l."organizationId" = fl."organizationId"
         AND l."fulfilmentLineId" = fl."id"
        LEFT JOIN invoice_fulfilment_allocations a
          ON a."organizationId" = fl."organizationId"
         AND a."fulfilmentLineId" = fl."id"
         AND a."invoiceId" = i."id"
        LEFT JOIN order_lines ol
          ON ol."organizationId" = fl."organizationId"
         AND ol."orderId" = fl."orderId"
         AND ol."id" = fl."orderLineId"
        WHERE fl."organizationId" = i."organizationId"
          AND fl."fulfilmentId" = i."fulfilmentId"
          AND fl."reversesLineId" IS NULL
          AND (
            l."id" IS NULL
            OR a."fulfilmentLineId" IS NULL
            OR l."quantity" <> fl."quantity"
            OR l."unit" <> fl."unit"
            OR l."unitPrice" <> ol."unitPrice"
            OR l."lineAmount" <> round(fl."quantity" * ol."unitPrice", 2)
          )
      )
  ) THEN
    RAISE EXCEPTION 'invoice does not reconcile to current committed fulfilment and issuance event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Fail the migration rather than silently accepting already-corrupt issued rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM invoices i
    LEFT JOIN orders o
      ON o."organizationId" = i."organizationId" AND o."id" = i."orderId"
    WHERE i."customerId" IS DISTINCT FROM o."customerId"
       OR i."currency" IS DISTINCT FROM o."currency"
       OR i."currency" <> 'JMD'
       OR EXISTS (
         SELECT 1 FROM fulfilments r
         WHERE r."organizationId" = i."organizationId"
           AND r."reversesFulfilmentId" = i."fulfilmentId"
       )
       OR (
         SELECT count(*) FROM invoice_lifecycle_events e
         WHERE e."organizationId" = i."organizationId"
           AND e."invoiceId" = i."id"
           AND e."type" = 'ISSUED'
           AND e."actorMembershipId" = i."issuedByMembershipId"
       ) <> 1
  ) THEN
    RAISE EXCEPTION 'existing invoices fail the new source/event integrity checks';
  END IF;
END;
$$;
