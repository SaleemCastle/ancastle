-- CreateTable
CREATE TABLE "mortality_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "flockId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "deathCount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cause" TEXT,
    "note" TEXT,
    "reference" TEXT,
    "reversesEventId" UUID,

    CONSTRAINT "mortality_events_pkey" PRIMARY KEY ("id")
);

-- Counts represent whole birds. Reversals retain a positive count too.
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_deathCount_positive_check"
CHECK ("deathCount" > 0);

ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_cause_length_check"
CHECK ("cause" IS NULL OR char_length("cause") <= 120);

ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_note_length_check"
CHECK ("note" IS NULL OR char_length("note") <= 2000);

ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_reference_length_check"
CHECK ("reference" IS NULL OR char_length("reference") <= 120);

ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_no_self_reversal_check"
CHECK ("reversesEventId" IS NULL OR "reversesEventId" <> "id");

-- CreateIndex
CREATE UNIQUE INDEX "mortality_events_reversesEventId_key" ON "mortality_events"("reversesEventId");

-- CreateIndex
CREATE INDEX "mortality_events_organizationId_farmId_flockId_occurredAt_idx" ON "mortality_events"("organizationId", "farmId", "flockId", "occurredAt");

-- CreateIndex
CREATE INDEX "mortality_events_actorUserId_idx" ON "mortality_events"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "mortality_events_organizationId_farmId_flockId_id_key" ON "mortality_events"("organizationId", "farmId", "flockId", "id");

-- AddForeignKey
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_organizationId_farmId_fkey" FOREIGN KEY ("organizationId", "farmId") REFERENCES "farms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_organizationId_farmId_flockId_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId") REFERENCES "flocks"("organizationId", "farmId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Actor must also belong to the event organization. Keep the direct User FK.
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_organizationId_actorUserId_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "organization_memberships"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mortality_events" ADD CONSTRAINT "mortality_events_organizationId_farmId_flockId_reversesEve_fkey" FOREIGN KEY ("organizationId", "farmId", "flockId", "reversesEventId") REFERENCES "mortality_events"("organizationId", "farmId", "flockId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Every correction fully cancels one original event. The unique reversal key
-- prevents double cancellation, including concurrent inserts. A corrected count
-- is a new original event, appended alongside the reversal in one transaction.
-- Effective mortality is the sum of originals minus the sum of reversals;
-- population/over-mortality calculations belong to later domain work.
CREATE FUNCTION "validate_mortality_reversal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    original "mortality_events"%ROWTYPE;
BEGIN
    IF NEW."reversesEventId" IS NOT NULL THEN
        SELECT * INTO original FROM "mortality_events"
        WHERE "id" = NEW."reversesEventId"
          AND "organizationId" = NEW."organizationId"
          AND "farmId" = NEW."farmId"
          AND "flockId" = NEW."flockId";

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Mortality reversal target must exist in the same flock'
                USING ERRCODE = '23503';
        END IF;
        IF original."reversesEventId" IS NOT NULL OR original."deathCount" <> NEW."deathCount" THEN
            RAISE EXCEPTION 'Mortality reversal must fully cancel an original event'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "mortality_events_validate_reversal"
BEFORE INSERT ON "mortality_events"
FOR EACH ROW EXECUTE FUNCTION "validate_mortality_reversal"();

-- Protect history even when persistence is accessed directly. No application
-- workflow may rewrite or remove posted mortality (including through TRUNCATE).
CREATE FUNCTION "reject_mortality_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Mortality history is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "mortality_events_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "mortality_events"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_mortality_history_mutation"();
