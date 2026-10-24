-- 0043 — the first-party analytics events store and its fold (analytics plan U1; origin KD1–KD6).
--
-- One append-only, fact-table-shaped store serves both consumers (KD1): the operator's SQL and the
-- product's future aggregate reads. It lives in the recipe database on purpose (KD2 — a warehouse can't
-- serve product reads and every free tier failed the market scan) but is warehouse-SHAPED so the
-- S3/Athena export door (origin R9) exists without redesign. Raw rows are kept 6 MONTHS (origin R10),
-- then deleted by U6's sweeper — but only after the fold below has counted them.
--
-- ⛔ THE FOLD IS A DELTA UPSERT, NEVER A RECOMPUTE — and only ever on INSERT (plan KTD1). Migration
-- 0010's ratings trigger is mirrored for MECHANICS (statement-level AFTER trigger, transition table)
-- and explicitly NOT for its math: 0010 recomputes from the base table, which is correct for ratings
-- (rows live forever) and FATAL here — after retention deletes aged rows, a recompute collapses a
-- lifetime count of 100 to the survivors, and 015's recognition history is silently destroyed. The
-- delta form reads ONLY the transition table, so deleted history is invisible to it by construction.
-- ⛔ There is NO UPDATE trigger and NO DELETE trigger — ABSENCE is the design, not no-op bodies: the
-- erasure sweep's anonymizing UPDATE (plan KTD8) and retention's DELETE must both fire NOTHING, and the
-- integration suite pins the trigger inventory at exactly one. Counts therefore never decrement — they
-- are LIFETIME ACTION COUNTS (KD6): not on unsave, not on erasure, not on retention.
--
-- ⛔ 0010's `SELECT … FOR UPDATE` pre-lock is deliberately NOT carried over (staff-architect blueprint,
-- 2026-09-01): a delta upsert is lost-update-safe on its own — `count = count + EXCLUDED.count` reads
-- the row under the upsert's own lock — and a pre-lock cannot lock a recipe's FIRST-touch row (it does
-- not exist yet), so it never provided the ordering guarantee it implied. Deadlock avoidance between
-- concurrent multi-recipe batches comes from `ORDER BY recipe_id` on the upsert's source instead.
--
-- ⛔ `ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING` — every writer MUST spell the
-- partial predicate, because the unique index below is PARTIAL (server-door rows carry NULL event_id
-- and must not occupy the namespace): a bare `ON CONFLICT (event_id)` has no arbiter index to infer
-- and errors at RUNTIME, not at migration time. Rows skipped by DO NOTHING are ABSENT from the
-- trigger's transition table (PostgreSQL populates it with rows actually inserted), which is why a
-- duplicate landing moves no counts with no extra guard.
--
-- ⛔ NO FOREIGN KEYS, in either direction, on purpose. `analytics_events.recipe_id` → recipes would
-- make every recipe DELETE pay an index probe on an unbounded fact table and would either cascade
-- (destroying the lifetime history KD6 promises survives) or block deletion; `user_id` → any user
-- table would break the anonymize-on-erase ruling (KD4 nulls it in place, rows survive their author).
-- `recipe_impact_signals.recipe_id` likewise keeps counts for deleted recipes — history outlives the
-- subject by design (015 reads it; SC2). Orphan tolerance is the accepted price and the operator's SQL
-- joins defensively.
--
-- Erasure posture (origin KD4, AE4; ADR-0027's precedent, deliberately STRICTER by ruling): the sweep
-- nulls `user_id` AND blanks `query_text` in place; the pair CHECK below is the structural guarantee
-- the erasure-coverage gate keys on — a typed query never survives without its author. The counts
-- table is recipe-keyed and deliberately VIEWER-LESS from birth (012-FR-024: no viewer column may ever
-- exist here); `cook_count` is provisioned unwritten because SC2 promises 015 finds its history home
-- ready. Retention and every index key `created_at` (server-stamped) — NEVER `occurred_at`, which is
-- client-asserted on ingest-door rows and cannot be trusted to bound a delete.

CREATE TABLE analytics_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Client-minted idempotency key (plan KTD5): NOT NULL on ingest-door rows (enforced below),
    -- NULL on server-door rows, which need no retry key.
    event_id uuid,
    event_type text NOT NULL
        CONSTRAINT analytics_events_type_valid
            CHECK (event_type IN ('recipe_saved', 'recipe_viewed', 'query_outcome')),
    -- The actor's opaque app ULID. NULL after erasure (KD4) — rows survive their author.
    user_id varchar(255),
    -- The recipe the event is about; NULL for query-family events.
    recipe_id uuid,
    -- The typed search text (query-family only). Blanked by the erasure sweep alongside user_id.
    query_text text,
    -- Family-shaped detail (served list, pick group/position, provenance). Never personal on its own.
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- When the action happened where it happened (client clock on ingest-door rows — untrusted).
    occurred_at timestamptz NOT NULL,
    -- When the row landed here (server clock — the ONLY time column retention or indexes may key).
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The erasure pairing rule (plan KTD8): a typed query may not outlive its author's id. The gate
    -- classifies the table by this named constraint.
    CONSTRAINT analytics_events_query_text_needs_user
        CHECK (query_text IS NULL OR user_id IS NOT NULL),
    -- Every non-query family folds by recipe, so a NULL recipe_id there would abort the capturing
    -- INSERT inside the trigger (NULL PK on the upsert). Refused at the row instead, with a message
    -- the capture path can log.
    CONSTRAINT analytics_events_credit_needs_recipe
        CHECK (event_type = 'query_outcome' OR recipe_id IS NOT NULL),
    -- Idempotency is a persistent invariant, not an ingest-route courtesy: a client-door row without
    -- its key could double-count on retry and no later reader could tell.
    CONSTRAINT analytics_events_client_event_needs_id
        CHECK (event_type <> 'query_outcome' OR event_id IS NOT NULL)
);

-- PARTIAL unique index: the idempotency namespace holds only client-minted ids; server-door rows
-- (event_id IS NULL) stay out of it entirely. Writers must repeat this predicate in ON CONFLICT.
CREATE UNIQUE INDEX analytics_events_event_id_key
    ON analytics_events (event_id)
    WHERE event_id IS NOT NULL;

-- U6's retention sweep: `DELETE … WHERE created_at < now() - interval '6 months'`.
CREATE INDEX analytics_events_created_idx ON analytics_events (created_at);

-- U2's erasure sweep: `UPDATE … WHERE user_id = $1`. Partial — anonymized rows leave the index.
CREATE INDEX analytics_events_user_idx ON analytics_events (user_id) WHERE user_id IS NOT NULL;

-- The operator's funnel SQL (origin R4, SC5): per-recipe event streams in time order.
CREATE INDEX analytics_events_recipe_idx
    ON analytics_events (recipe_id, created_at)
    WHERE recipe_id IS NOT NULL;

CREATE TABLE recipe_impact_signals (
    recipe_id uuid PRIMARY KEY,
    save_count bigint NOT NULL DEFAULT 0
        CONSTRAINT recipe_impact_signals_save_count_nonneg CHECK (save_count >= 0),
    view_count bigint NOT NULL DEFAULT 0
        CONSTRAINT recipe_impact_signals_view_count_nonneg CHECK (view_count >= 0),
    -- Provisioned for 015's `recipe_cooked` (plan KTD2, SC2). Unwritten in v1: the fold below does
    -- not touch it, and nothing reads it until 015's counting rules are real.
    cook_count bigint NOT NULL DEFAULT 0
        CONSTRAINT recipe_impact_signals_cook_count_nonneg CHECK (cook_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE recipe_impact_signals IS
    'Lifetime action counts folded from analytics_events by trigger analytics_events_fold_on_insert — '
    'the ONLY legal writer. Never decremented: not by unsave, not by erasure, not by retention (KD6). '
    'Deliberately viewer-less (012-FR-024). cook_count is provisioned for 015, unwritten in v1.';

-- The delta fold (plan KTD1). Reads ONLY the transition table; `ORDER BY recipe_id` on the source
-- gives concurrent multi-recipe batches a consistent lock order on the upsert targets.
CREATE FUNCTION analytics_events_fold() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO recipe_impact_signals (recipe_id, save_count, view_count, updated_at)
    SELECT
        new_rows.recipe_id,
        count(*) FILTER (WHERE new_rows.event_type = 'recipe_saved'),
        count(*) FILTER (WHERE new_rows.event_type = 'recipe_viewed'),
        now()
    FROM new_rows
    WHERE new_rows.event_type IN ('recipe_saved', 'recipe_viewed')
    GROUP BY new_rows.recipe_id
    ORDER BY new_rows.recipe_id
    ON CONFLICT (recipe_id) DO UPDATE SET
        save_count = recipe_impact_signals.save_count + EXCLUDED.save_count,
        view_count = recipe_impact_signals.view_count + EXCLUDED.view_count,
        updated_at = now();

    RETURN NULL;
END;
$$;

-- Exactly ONE trigger, INSERT only — see the header for why UPDATE and DELETE triggers are forbidden.
CREATE TRIGGER analytics_events_fold_on_insert
    AFTER INSERT ON analytics_events
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION analytics_events_fold();
