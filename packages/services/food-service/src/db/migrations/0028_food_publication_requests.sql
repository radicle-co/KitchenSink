-- 0028 — the publication request (ADR-0029 §5 and §7; owner rulings 2026-11-08 and 2026-11-09).
--
-- ── One table serves both asks ───────────────────────────────────────────────────────────────────
--   The author asks to make a PRIVATE food public, and the author edits a PUBLIC food: both become a pending row that
--   points at one food_versions row. Staff approve or decline it. Approval applies that version's snapshot to the live
--   food row and sets visibility = 'promoted'; the live row is always the approved version.
--
-- ── No person columns, by design ─────────────────────────────────────────────────────────────────
--   The author is food.user_id, derived by join. The staff member's id reaches the audit log only (the requeue
--   precedent). So this table never enters the erasure sweep's owner-bearing set, and it cascades with its food.
--
-- ── One pending request per food ─────────────────────────────────────────────────────────────────
--   The partial unique makes a double click an ON CONFLICT no-op. A newer edit CLOSES the older pending request, so
--   staff only ever approve the newest version.
--
-- ── food_promotions is dropped ───────────────────────────────────────────────────────────────────
--   The corroboration queue (0015) never had a reader: no code selects from it. Its replacement is this table.

CREATE TABLE "food_publication_requests" (
    "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "food_id"             text NOT NULL,
    "food_version_number" integer NOT NULL,
    "status"              text NOT NULL DEFAULT 'pending'
        CONSTRAINT "food_publication_requests_status_valid"
        CHECK ("status" IN ('pending', 'approved', 'declined', 'closed')),
    "decline_reason"      text,
    "created_at"          timestamptz NOT NULL DEFAULT now(),
    "decided_at"          timestamptz,
    -- When the author opened the food after the decision (the dot on "Your foods"). A time, not a person: the author
    -- is food.user_id. Only a decided request can have been seen.
    "author_seen_at"      timestamptz,
    CONSTRAINT "food_publication_requests_version_fk" FOREIGN KEY ("food_id", "food_version_number")
        REFERENCES "food_versions" ("food_id", "version_number") ON DELETE CASCADE,
    CONSTRAINT "food_publication_requests_food_fk" FOREIGN KEY ("food_id")
        REFERENCES "food" ("id") ON DELETE CASCADE,
    -- A decision carries a time; only a decline carries a reason. Illegal states unrepresentable.
    CONSTRAINT "food_publication_requests_seen_after_decision" CHECK (
        "author_seen_at" IS NULL OR "decided_at" IS NOT NULL
    ),
    CONSTRAINT "food_publication_requests_decision_coherent" CHECK (
        ("status" = 'pending' AND "decided_at" IS NULL AND "decline_reason" IS NULL)
        OR ("status" IN ('approved', 'closed') AND "decided_at" IS NOT NULL AND "decline_reason" IS NULL)
        OR ("status" = 'declined' AND "decided_at" IS NOT NULL AND "decline_reason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "food_publication_requests_pending_unique" ON "food_publication_requests" ("food_id")
    WHERE "status" = 'pending';
CREATE INDEX "idx_food_publication_requests_food" ON "food_publication_requests" ("food_id");

DROP TABLE "food_promotions";
