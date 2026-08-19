/**
 * The seeded world's COMPOSITION, proved against the real Nest app + Docker Postgres.
 *
 * `src/database/seed.ts` used to insert into `recipes` only — no `recipe_ingredients`, no `recipe_steps` —
 * so every seeded recipe rendered an empty ingredient checklist and an empty step list. Three things
 * depended on that gap and could not be asserted anywhere: the mobile detail flow's ingredient/step/
 * checkbox claims, the USDA-disclosure gate (its `assertNotVisible` was VACUOUS — nothing to disclose),
 * and any proof that `recipes.ingredient_names_text` is written at all.
 *
 * This spec is the fixture's own test, and it lives at the integration tier because every claim it makes
 * is a claim about a DATABASE:
 *
 *   - the lines and steps LAND, survive the FK/CHECK/UNIQUE constraints, and read back through the
 *     service in author order (a unit test over the constants cannot observe a row that never inserted);
 *   - `ingredient_names_text` is populated, which only the `trg_recipes_search_vector` trigger can
 *     demonstrate — a seeded recipe is findable by an ingredient name that appears in NO title or
 *     description, i.e. only the weight-C branch can have matched it;
 *   - re-seeding is a NO-OP, which is the entire reason the fixture uses stable ids.
 *
 * It calls {@link seed} itself in `beforeAll` rather than trusting the global setup's one-time run:
 * sibling integration specs wipe `recipes` / `ingredients` wholesale for their own isolation
 * (`search/search.integration.test.ts`, `ingredients/search.integration.test.ts`), and with
 * `fileParallelism: false` this file may run after either. Re-seeding is idempotent, so this is a restore,
 * not a second fixture — and the no-op assertion below is what proves that.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    seed,
    seedIngredientNamesText,
    SEED_OWNER_FREE,
    SEED_OWNER_PRO,
    SEED_RECIPE_INGREDIENT_LINES,
    SEED_RECIPE_STEPS,
    SEED_RECIPES,
} from '../../../src/database/seed.js';
import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The wire projection of one persisted ingredient line (`unit` absent when the line is unitless). */
interface IngredientLineBody {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    isUserEntered: boolean;
}

/** The wire projection of one persisted step. */
interface StepBody {
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

interface RecipeDetailBody {
    id: string;
    title: string;
    ingredients: IngredientLineBody[];
    steps: StepBody[];
}

interface SearchBody {
    total: number;
    results: { recipe: { id: string; title: string } }[];
}

/** The lamb — the recipe `recipes/list-detail.yaml` drills into on mobile. */
const LAMB = SEED_RECIPES[0]!;

/**
 * A token that appears in Herb Risotto's INGREDIENT names and in no seeded title or description, so a
 * search hit on it can only have come through `ingredient_names_text` (trigger weight C).
 */
const INGREDIENT_ONLY_TOKEN = 'arborio';

describe.skipIf(!hasDatabaseUrl)('the seeded world composes recipes, ingredients and steps (integration)', () => {
    let pool: pg.Pool;
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await seed(pool);
        booted = await bootRecipeApp({ devAuthUserId: SEED_OWNER_FREE });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
        await pool.end();
    });

    /** Read a seeded recipe's detail as its owner. */
    async function detailAs(ownerId: string, recipeId: string): Promise<RecipeDetailBody> {
        return asPrincipal(ownerId, async () => {
            const response = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`);
            expect(response.status).toBe(200);

            return (await response.json()) as RecipeDetailBody;
        });
    }

    it('reads the lamb back with EXACTLY its seeded ingredient lines, in author order', async () => {
        const detail = await detailAs(LAMB.ownerId, LAMB.id);

        const expected = SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === LAMB.id).map((line) => ({
            ingredientId: line.ingredient.id,
            name: line.ingredient.name,
            quantity: line.quantity,
            // A seeded line is a plain measure with no note, and an empty `unit` is projected as ABSENT.
            ...(line.unit.length > 0 ? { unit: line.unit } : {}),
            // Every seeded catalog row is `is_user_entered = true` — a DB-only fixture has no food service
            // in the loop, so it cannot honestly mint a food-backed line. This is what makes the mobile
            // detail render the USDA/custom-ingredient disclosure (REQ-034), and why
            // `recipes/list-detail.yaml` now asserts that notice VISIBLE.
            isUserEntered: true,
        }));

        expect(expected.length).toBeGreaterThan(0);
        expect(detail.ingredients).toEqual(expected);

        // The wire order above is only as strong as the column it is sorted by. Left at the schema's
        // `DEFAULT 0` for every line, the read would still come back in insertion order and this test would
        // pass by luck — so the persisted `sort_order` is asserted directly: 0..n-1, in author order.
        const { rows } = await pool.query<{ sortOrder: number; ingredientName: string }>(
            `SELECT sort_order AS "sortOrder", ingredient_name AS "ingredientName"
               FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
            [LAMB.id],
        );
        expect(rows.map((row) => row.sortOrder)).toEqual(expected.map((_, index) => index));
        expect(rows.map((row) => row.ingredientName)).toEqual(expected.map((line) => line.name));
    });

    it('reads the lamb back with EXACTLY its seeded steps, numbered from 1', async () => {
        const detail = await detailAs(LAMB.ownerId, LAMB.id);

        const expected = SEED_RECIPE_STEPS.filter((step) => step.recipeId === LAMB.id).map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        }));

        expect(expected.length).toBeGreaterThan(0);
        expect(detail.steps).toEqual(expected);
        expect(detail.steps[0]?.stepNumber).toBe(1);
    });

    it('gives EVERY seeded recipe — both owners, public and private — real lines and real steps', async () => {
        for (const recipe of SEED_RECIPES) {
            const detail = await detailAs(recipe.ownerId, recipe.id);

            expect(detail.title).toBe(recipe.title);
            // Counted against the fixture, not a magic number: a recipe that persisted only SOME of its
            // lines (a duplicated derived id, a swallowed conflict) fails here.
            expect(detail.ingredients).toHaveLength(
                SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === recipe.id).length,
            );
            expect(detail.steps).toHaveLength(SEED_RECIPE_STEPS.filter((step) => step.recipeId === recipe.id).length);
            expect(detail.ingredients.length).toBeGreaterThan(0);
            expect(detail.steps.length).toBeGreaterThan(0);

            for (const line of detail.ingredients) {
                expect(line.name.length).toBeGreaterThan(0);
                expect(line.quantity).toBeGreaterThan(0);
            }
        }
    });

    it('writes ingredient_names_text, so a seeded recipe is findable by an ingredient alone', async () => {
        const risotto = SEED_RECIPES.find((recipe) => recipe.title === 'Herb Risotto')!;

        // The precondition that makes this test meaningful: the token is in NO title and NO description,
        // so the only branch of the trigger that can produce a hit is weight C (ingredient_names_text).
        for (const recipe of SEED_RECIPES) {
            expect(`${recipe.title} ${recipe.description}`.toLowerCase()).not.toContain(INGREDIENT_ONLY_TOKEN);
        }

        expect(seedIngredientNamesText(risotto.id).toLowerCase()).toContain(INGREDIENT_ONLY_TOKEN);

        const found = await asPrincipal(SEED_OWNER_PRO, async () => {
            const response = await fetch(`${baseUrl}/api/v1/search/recipes?query=${INGREDIENT_ONLY_TOKEN}&pageSize=50`);
            expect(response.status).toBe(200);

            return (await response.json()) as SearchBody;
        });

        expect(found.results.map((hit) => hit.recipe.id)).toContain(risotto.id);
    });

    it('is a NO-OP on re-seed — every child row keeps a stable identity', async () => {
        const before = await countSeededChildren(pool);

        const counts = await seed(pool);

        // Not "some rows were skipped": NOTHING was inserted. A line or step whose identity is not stable
        // would re-insert here and duplicate itself on every deploy / test boot.
        expect(counts).toEqual({
            ingredients: 0,
            recipes: 0,
            recipesRepaired: 0,
            recipeIngredients: 0,
            recipeSteps: 0,
            collections: 0,
            memberships: 0,
        });
        expect(await countSeededChildren(pool)).toEqual(before);
    });

    /**
     * The failure mode `ON CONFLICT (id) DO NOTHING` creates for a DERIVED column, reproduced.
     *
     * Verified by hand against a long-lived local database seeded before the fixture had ingredients:
     * re-running the seed inserted 20 catalog rows, 25 lines and 19 steps — and left every recipe's
     * `ingredient_names_text` at its `DEFAULT ''`, because the recipe ROW already existed and was skipped.
     * The result is silent: the recipes look complete on the detail screen and are unfindable by any of
     * their own ingredients, and nothing else reads the column, so no other test can notice.
     *
     * The repair is deliberately narrow — it fires ONLY on the empty default, so it can restore what an
     * older seed never wrote without ever overwriting a value the SERVICE wrote for a recipe someone
     * edited.
     */
    it('repairs a seeded recipe whose ingredient_names_text an older seed left empty', async () => {
        await pool.query(`UPDATE recipes SET ingredient_names_text = '' WHERE id = $1`, [LAMB.id]);

        // Precondition: the recipe really is unfindable by its own ingredient now. The UPDATE fires
        // `trg_recipes_search_vector`, which rebuilds the vector with an empty weight-C branch.
        expect(await searchIdsFor('oregano')).not.toContain(LAMB.id);

        const counts = await seed(pool);

        // A repair is NOT an insert, and is counted (and logged) as its own thing rather than inflating
        // "inserted 1 recipe" — the CLI's summary is the only signal a human gets from a seed run.
        expect(counts.recipesRepaired).toBe(1);
        expect(counts.recipes).toBe(0);

        const { rows } = await pool.query<{ text: string }>(
            'SELECT ingredient_names_text AS text FROM recipes WHERE id = $1',
            [LAMB.id],
        );
        expect(rows[0]?.text).toBe(seedIngredientNamesText(LAMB.id));
        expect(await searchIdsFor('oregano')).toContain(LAMB.id);

        // …and the repaired world is a no-op again, so the repair cannot become a per-run rewrite.
        expect((await seed(pool)).recipesRepaired).toBe(0);
    });

    /** Search as the free owner (the lamb is private) and return the matched recipe ids. */
    async function searchIdsFor(query: string): Promise<string[]> {
        return asPrincipal(SEED_OWNER_FREE, async () => {
            const response = await fetch(`${baseUrl}/api/v1/search/recipes?query=${query}&pageSize=50`);
            expect(response.status).toBe(200);
            const body = (await response.json()) as SearchBody;

            return body.results.map((hit) => hit.recipe.id);
        });
    }
});

/** Count the seeded recipes' persisted lines and steps. */
async function countSeededChildren(pool: pg.Pool): Promise<{ lines: number; steps: number }> {
    const recipeIds = SEED_RECIPES.map((recipe) => recipe.id);

    const lines = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM recipe_ingredients WHERE recipe_id = ANY($1::uuid[])',
        [recipeIds],
    );
    const steps = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM recipe_steps WHERE recipe_id = ANY($1::uuid[])',
        [recipeIds],
    );

    return { lines: Number(lines.rows[0]!.count), steps: Number(steps.rows[0]!.count) };
}
