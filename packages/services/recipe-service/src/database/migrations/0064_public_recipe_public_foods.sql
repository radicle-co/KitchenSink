-- 0064 — a published, public recipe holds no line bound to a private food (ADR-0029 §4; owner rulings 2026-11-08).
--
-- ── The rule is written ONCE, in two functions ───────────────────────────────────────────────────
--   recipe_private_food_lines(recipe) names each line bound to a food its author keeps private, by its position
--   (sort_order) and the food id, so the refusal can tell the cook WHICH lines. recipe_holds_private_food(recipe) is the
--   same question as a boolean. The service's policy asks the first; the triggers below ask the second. Nothing else
--   restates the rule.
--
-- ── Constraint triggers, because the rule spans two tables ───────────────────────────────────────
--   A CHECK sees one row. The violation can come from a line (a private food added to a public recipe) or from the
--   recipe (a recipe holding a private line made public or published), so each table carries a trigger, and a write
--   path the service forgets is a rolled-back transaction rather than a leak.
--
-- ── FOR SHARE first, so the two races lose cleanly ───────────────────────────────────────────────
--   The line trigger takes FOR SHARE on the recipe row before it reads the recipe's state, and holds it to the end of
--   the transaction. An UPDATE of the recipe needs a stronger lock, so it WAITS for a line being added, and then its own
--   trigger sees the committed line. In the other order the line's lock request waits for the recipe update and then
--   reads the NEW state. Either order ends in one raise; neither ends in a public recipe holding a private food.
--
-- ── Exempt: a draft, a private recipe, a soft-deleted one ────────────────────────────────────────
--   Only a recipe the world can read is bound. A soft-deleted recipe is out of every read, and its lines must stay
--   writable for erasure. Restoring one (deleted_at back to NULL) is re-checked, so it is not a door.
--
-- ⚠️ EXPAND-ONLY and without a backfill: the triggers judge writes from now on, and nothing is live (owner, 2026-09-26).

CREATE OR REPLACE FUNCTION recipe_private_food_lines(p_recipe_id uuid)
RETURNS TABLE (sort_order integer, food_id text)
LANGUAGE sql STABLE AS $$
    SELECT i.sort_order, l.food_id
      FROM ingredients i
      JOIN food_lookups l ON l.id = i.food_lookup_id
     WHERE i.recipe_id = p_recipe_id
       AND l.food_owner_id IS NOT NULL
     ORDER BY i.sort_order, i.id
$$;

CREATE OR REPLACE FUNCTION recipe_holds_private_food(p_recipe_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM recipe_private_food_lines(p_recipe_id))
$$;

CREATE OR REPLACE FUNCTION ingredients_public_recipe_no_private_food() RETURNS trigger AS $$
DECLARE
    v_visibility text;
    v_status     text;
    v_deleted    timestamptz;
BEGIN
    SELECT r.visibility, r.status, r.deleted_at
      INTO v_visibility, v_status, v_deleted
      FROM recipes r
     WHERE r.id = NEW.recipe_id
       FOR SHARE;

    IF v_visibility = 'public' AND v_status = 'published' AND v_deleted IS NULL
       AND EXISTS (
           SELECT 1 FROM food_lookups l WHERE l.id = NEW.food_lookup_id AND l.food_owner_id IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'a published public recipe cannot hold a line bound to a private food (ADR-0029 section 4)'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ingredients_public_recipe_no_private_food';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recipes_public_holds_no_private_food() RETURNS trigger AS $$
BEGIN
    IF NEW.visibility = 'public' AND NEW.status = 'published' AND NEW.deleted_at IS NULL
       AND recipe_holds_private_food(NEW.id) THEN
        RAISE EXCEPTION 'a published public recipe cannot hold a line bound to a private food (ADR-0029 section 4)'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'recipes_public_holds_no_private_food';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ingredients_public_recipe_no_private_food
    AFTER INSERT OR UPDATE OF food_lookup_id, recipe_id
    ON ingredients
    FOR EACH ROW
    EXECUTE FUNCTION ingredients_public_recipe_no_private_food();

CREATE CONSTRAINT TRIGGER recipes_public_holds_no_private_food
    AFTER UPDATE OF visibility, status, deleted_at
    ON recipes
    FOR EACH ROW
    EXECUTE FUNCTION recipes_public_holds_no_private_food();
