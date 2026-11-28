-- 0098 — the read rule's hold, as ONE SQL function (ADR-0105).
--
-- A recipe is HELD FROM READERS when any of three terms holds; a held recipe is read only by its owner:
--   (a) the correction hold column (`source_correction_hold`);
--   (b) cook-captured third-party evidence: `recipe_has_cook_source_evidence`, below;
--   (c) a private-only label: `source_type || ':' || coalesce(source_kind, '')` is one of the BOUND `private_only_keys`
--       (recipe-core's PRIVATE_ONLY_SOURCE_KEYS, passed as one jsonb array by every caller, never copied here).
--
-- Two evidence definitions exist on purpose until a later change aligns them. The WRITE side (`recipe_holds_third_party_source`,
-- 0086, and `sourceConflictOf`) counts every evidence row. This READ side ignores `capture = 'staffCorrection'` rows, so a
-- mistaken staff correction, once undone and cleared, is readable again; a correct correction to a book stays hidden through
-- term (c). `recipe_holds_third_party_source` is untouched. The content-source check's `SOURCE_CHECK_ALLOWS_SQL` sits BESIDE
-- this function in the service predicates and never inside it.
--
-- The argument is the caller's whole `recipes` row, so no caller names an origin column and a later change to the inputs
-- replaces only this body. Both functions answer a strict boolean, never NULL.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION recipe_has_cook_source_evidence(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipe_source_evidence e
         WHERE e.recipe_id = p_recipe_id
           AND e.capture <> 'staffCorrection'
           AND (e.source_domain IS NOT NULL OR e.source_kind IN ('book', 'paid_site'))
    );
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

CREATE FUNCTION recipe_held_from_readers(r recipes, private_only_keys jsonb) RETURNS boolean AS $$
    SELECT coalesce(r.source_correction_hold, false)
        OR recipe_has_cook_source_evidence(r.id)
        OR coalesce(
               (r.source_type || ':' || coalesce(r.source_kind, '')) IN (SELECT jsonb_array_elements_text(private_only_keys)),
               false);
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;
