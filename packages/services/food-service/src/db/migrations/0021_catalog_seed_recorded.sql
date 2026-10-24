-- 0021: a seeder commit that changes the catalog records a seed in the same transaction, and every ledger row names the
-- login that wrote it (curated catalog plan KTD-4, KTD-12; database review 2026-10-02).
--
-- Applied once by the in-VPC runner, inside its own BEGIN/COMMIT, so it opens no transaction. The Drizzle mirror of
-- the ledger is src/db/schema/seedLedger.ts.
--
-- ── Why ──────────────────────────────────────────────────────────────────────────────────────────
-- The seed writes the catalog, runs its verifier, then appends its digest to the ledger in the same transaction
-- (src/foods/seed/catalog/catalogSeedTransaction.ts). Only that code tied the two together: a seeder session that
-- changed catalog rows and committed with no ledger row would leave seed-owned rows no digest accounts for, and the
-- deploy gate would read the previous digest as current.
--
-- ── applied_by ───────────────────────────────────────────────────────────────────────────────────
-- The session user at insert, so a SECURITY DEFINER function cannot launder it. An inserter can still write the column
-- itself; only the seeder and the owner's members can insert at all (the runner's seed-writer premise, re-read on every
-- migrate), so the worst case is a misattributed row, never a forged one.
--
-- ── The check ────────────────────────────────────────────────────────────────────────────────────
-- A constraint trigger is row-level only, so each catalog table gets one, queued only when catalog_writer reads the
-- seeder: its WHEN runs at the row event, so food_app's live writes and the owner's never queue a check. At commit it
-- asks whether the NEWEST ledger row is this transaction's: one primary-key probe per queued row, never a scan. A
-- concurrent seed's newer row makes it refuse, which is the safe side, and the seed lock (KTD-2) serialises applies.
-- Like 0018's functions it names the ledger by schema and pins pg_temp last, because the seeder holds TEMPORARY and a
-- temporary catalog_seed_ledger holding a row of this transaction would otherwise satisfy it.
--
-- The table list is the registry's catalog set (src/db/schema/catalog.ts); tests/e2e/catalogSchema.e2e.test.ts holds
-- the two equal.

ALTER TABLE "catalog_seed_ledger" ADD COLUMN "applied_by" text DEFAULT session_user NOT NULL;

CREATE FUNCTION "catalog_seed_recorded"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM (SELECT l.xmin AS written_by FROM public.catalog_seed_ledger l ORDER BY l.id DESC LIMIT 1) AS newest
         WHERE public.catalog_written_here(newest.written_by)
    ) THEN
        RAISE EXCEPTION 'the seeder changed % rows and recorded no seed in catalog_seed_ledger', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END
$$;

DO $$
DECLARE
    catalog text;
BEGIN
    FOREACH catalog IN ARRAY ARRAY[
        'food_item', 'food', 'food_variant', 'food_variant_part', 'food_sources', 'food_field_provenance',
        'food_category_assignment', 'food_nutrition', 'food_nutrition_citation', 'food_nutrition_value',
        'food_portions', 'food_forward'
    ] LOOP
        EXECUTE format(
            'CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED
                 FOR EACH ROW WHEN (public.catalog_writer(%L::regclass) = ''seeder'')
                 EXECUTE FUNCTION catalog_seed_recorded()',
            catalog || '_seed_recorded', catalog, 'public.' || catalog
        );
    END LOOP;
END
$$;
