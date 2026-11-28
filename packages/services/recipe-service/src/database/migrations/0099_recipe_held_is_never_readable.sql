-- 0099 — a held recipe may be public; the read rule hides it (ADR-0105).
--
-- 0092's CHECK `recipes_held_is_not_public` refused `visibility = 'public'` on a held row. The hold is now ONE term of the read
-- function `recipe_held_from_readers` (0098), which every non-owner read path calls, so "held" no longer needs a private row:
-- a held recipe keeps its audience and is read only by its owner. The CHECK is dropped, nothing replaces it in the database
-- (readability depends on the viewer, which no CHECK can state), and the repo guard plus the LOCAL e2e on every read path
-- are the backstop.
--
-- Forward-only: once a held public row exists, re-adding the CHECK fails; set those rows private or clear the hold first.
--
-- Unchanged: the hold ratchet (false to true only) and the BEFORE INSERT trigger that copies the hold onto a clone.
-- EXPAND-THEN-CONTRACT (DD16): 0098 is deployed, so every reader already hides a held row before this runs. Dropping a CHECK
-- takes a brief ACCESS EXCLUSIVE lock and no table scan.

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipes DROP CONSTRAINT recipes_held_is_not_public;

COMMENT ON COLUMN recipes.source_correction_hold IS
    'True once a staff correction that could itself open a Public path was applied to this recipe or to the recipe it was cloned from. Never cleared by a cook; staff clear it (ADR-0103). A held recipe is never publicly readable: the read function recipe_held_from_readers hides it, whatever its visibility (ADR-0105).';
