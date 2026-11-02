-- CreateTable
CREATE TABLE "feed_usages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "flockId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "inventoryMovementId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "reference" TEXT,
    "reversesUsageId" UUID,

    CONSTRAINT "feed_usages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_quantity_positive_check"
CHECK ("quantity" > 0 AND "quantity" <= 999999999999999.999);

ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_note_length_check"
CHECK ("note" IS NULL OR char_length("note") <= 2000);

ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_reference_length_check"
CHECK ("reference" IS NULL OR char_length("reference") <= 120);

ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_no_self_reversal_check"
CHECK ("reversesUsageId" IS NULL OR "reversesUsageId" <> "id");

-- CreateIndex
CREATE UNIQUE INDEX "feed_usages_inventoryMovementId_key" ON "feed_usages"("inventoryMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_usages_reversesUsageId_key" ON "feed_usages"("reversesUsageId");

-- CreateIndex
CREATE INDEX "feed_usages_organizationId_farmId_flockId_occurredAt_idx" ON "feed_usages"("organizationId", "farmId", "flockId", "occurredAt");

-- CreateIndex
CREATE INDEX "feed_usages_organizationId_inventoryItemId_idx" ON "feed_usages"("organizationId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "feed_usages_actorUserId_idx" ON "feed_usages"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_usages_organizationId_farmId_flockId_inventoryItemId_i_key" ON "feed_usages"("organizationId", "farmId", "flockId", "inventoryItemId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_organizationId_farmId_inventoryItemId_i_key" ON "inventory_movements"("organizationId", "farmId", "inventoryItemId", "id");

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_farmId_flockId_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId") REFERENCES "flocks"("organizationId", "farmId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_inventoryItemId_fkey" FOREIGN KEY ("organizationId", "inventoryItemId") REFERENCES "inventory_items"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_farmId_inventoryItemId_inventor_fkey" FOREIGN KEY ("organizationId", "farmId", "inventoryItemId", "inventoryMovementId") REFERENCES "inventory_movements"("organizationId", "farmId", "inventoryItemId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "feed_usages" ADD CONSTRAINT "feed_usages_organizationId_farmId_flockId_inventoryItemId__fkey" FOREIGN KEY ("organizationId", "farmId", "flockId", "inventoryItemId", "reversesUsageId") REFERENCES "feed_usages"("organizationId", "farmId", "flockId", "inventoryItemId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The required scoped FK and unique movement ID enforce one movement per usage.
-- Validate the cross-row signed quantity/audit semantics before admitting history.
CREATE FUNCTION "validate_feed_usage_link"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    movement "inventory_movements"%ROWTYPE;
    original "feed_usages"%ROWTYPE;
BEGIN
    SELECT * INTO movement FROM "inventory_movements"
    WHERE "id" = NEW."inventoryMovementId"
      AND "organizationId" = NEW."organizationId"
      AND "farmId" = NEW."farmId"
      AND "inventoryItemId" = NEW."inventoryItemId"
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feed movement must exist in the same stock position' USING ERRCODE = '23503';
    END IF;
    IF movement."actorUserId" <> NEW."actorUserId" OR movement."occurredAt" <> NEW."occurredAt" THEN
        RAISE EXCEPTION 'Feed usage and movement audit identity must match' USING ERRCODE = '23514';
    END IF;
    IF NEW."reversesUsageId" IS NULL THEN
        IF movement."quantity" <> -NEW."quantity" OR movement."reason" <> 'ISSUE' THEN
            RAISE EXCEPTION 'Feed consumption must match a negative ISSUE' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "inventory_items" WHERE "id" = NEW."inventoryItemId"
            AND "organizationId" = NEW."organizationId" AND "category" = 'FEED') THEN
            RAISE EXCEPTION 'Feed consumption requires a feed item' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT * INTO original FROM "feed_usages"
        WHERE "id" = NEW."reversesUsageId"
          AND "organizationId" = NEW."organizationId" AND "farmId" = NEW."farmId"
          AND "flockId" = NEW."flockId" AND "inventoryItemId" = NEW."inventoryItemId";
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Feed reversal target must exist in the same scope' USING ERRCODE = '23503';
        END IF;
        IF original."reversesUsageId" IS NOT NULL OR original."quantity" <> NEW."quantity"
            OR movement."quantity" <> NEW."quantity" OR movement."reason" <> 'ADJUSTMENT' THEN
            RAISE EXCEPTION 'Feed reversal must fully compensate an original usage' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "feed_usages_validate_link"
BEFORE INSERT ON "feed_usages"
FOR EACH ROW EXECUTE FUNCTION "validate_feed_usage_link"();

CREATE FUNCTION "reject_feed_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Feed usage history is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "feed_usages_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "feed_usages"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_feed_history_mutation"();

-- Existing M3 application workflows already append compensating movements.
-- Guard linked movements at the database too, so they cannot diverge from feed
-- history through direct persistence. Unlinked M3 behavior is unchanged.
CREATE FUNCTION "protect_feed_inventory_movement"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "feed_usages" WHERE "inventoryMovementId" = OLD."id") THEN
        RAISE EXCEPTION 'Feed-linked inventory history is append-only' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_movements_protect_feed_link"
BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "protect_feed_inventory_movement"();
