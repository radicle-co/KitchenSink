-- 0015 — the promotion moderation queue (plan U12; Q5 / D8; owner ruling 2026-08-30).
--
-- ── Corroboration is the TRIGGER, never the PUBLISHER ─────────────────────────────────────────────
--   Cross-author agreement on a private authored food (same normalized name, compatible macros,
--   distinct tenured authors — `promotionPolicy.ts`) creates a PENDING row here. Nothing publishes
--   until an operator approves it through the admin routes; two throwaway accounts can mint a queue
--   entry and NOTHING more. This closes the Sybil bypass around the verification funnel the security
--   review named.
--
-- ── No person columns, by design ──────────────────────────────────────────────────────────────────
--   The row records CONTRIBUTING FOOD ids (jsonb); their authors are derivable by join at review time.
--   The operator's identity reaches the AUDIT LOG only (the `foods/:id/requeue` precedent) — so this
--   table never enters the erasure sweep's owner-bearing set, and R24's gate stays untouched.
--
-- ── The rejection fingerprint is the resubmission bar ─────────────────────────────────────────────
--   `data_fingerprint` hashes the sorted contributing food ids with each food's macro 4-tuple. A
--   REJECTED row's fingerprint bars an identical candidacy forever; a new corroborating author or a
--   macro edit changes the fingerprint and re-opens the door. The queue cannot be griefed by
--   resubmission.
--
-- ── One PENDING candidacy per name ────────────────────────────────────────────────────────────────
--   The partial unique below makes the detector's concurrent double-trigger an ON CONFLICT no-op
--   rather than two review items for one decision.

CREATE TABLE "food_promotions" (
    "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "normalized_name"    text NOT NULL,
    -- The compatible contributing foods, ordered by id. jsonb (not rows) because the set is decided
    -- ATOMICALLY by one policy evaluation and reviewed as one unit; a join table would invite partial
    -- updates of a set that has exactly one writer and no per-element lifecycle.
    "candidate_food_ids" jsonb NOT NULL,
    "data_fingerprint"   varchar(64) NOT NULL,
    "status"             text NOT NULL DEFAULT 'pending'
        CONSTRAINT "food_promotions_status_valid" CHECK ("status" IN ('pending', 'approved', 'rejected')),
    -- The elected survivor — set at approval (phase 1), NULL before and on rejection.
    "canonical_food_id"  text,
    "created_at"         timestamptz NOT NULL DEFAULT now(),
    "decided_at"         timestamptz,
    -- Approval names a canonical; a pending or rejected row names none. Illegal states unrepresentable.
    CONSTRAINT "food_promotions_decision_coherent" CHECK (
        ("status" = 'approved' AND "canonical_food_id" IS NOT NULL AND "decided_at" IS NOT NULL)
        OR ("status" = 'rejected' AND "canonical_food_id" IS NULL AND "decided_at" IS NOT NULL)
        OR ("status" = 'pending' AND "canonical_food_id" IS NULL AND "decided_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "food_promotions_pending_name_unique" ON "food_promotions" ("normalized_name")
    WHERE "status" = 'pending';
CREATE INDEX "idx_food_promotions_name" ON "food_promotions" ("normalized_name");
