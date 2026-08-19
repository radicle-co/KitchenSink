/**
 * Deterministic E2E/dev seed (T096): a fixed catalog of ingredients + a fixed set of recipes — each with
 * REAL ingredient lines and REAL steps — plus one collection, owned by two stable test subjects (a
 * free-tier and a pro-tier Clerk subject) keyed by `owner_id`. There is NO `users` table to seed (D2) —
 * ownership is the app-user ULID carried on the token. Idempotent via stable ids + `ON CONFLICT DO
 * NOTHING`, so it is safe to run on every deploy / test boot.
 *
 * This module is the ONE authoritative definition of "the seeded world" (T097): `tests/globalSetup.ts`
 * calls {@link seed} and re-exports the catalog for the specs that reference it, so there is a single
 * source of truth rather than a divergent hand-rolled baseline.
 *
 * The ingredient catalog is load-bearing: since T043b, recipe create/update validates every line's
 * `ingredientId` against it, so the integration/e2e specs that build recipes referencing these ids
 * depend on these rows existing.
 *
 * ⚠️ WHAT A DB-ONLY SEED CANNOT HONESTLY PRODUCE. Every catalog row is inserted `is_user_entered = true`.
 * A food-BACKED row (`food_id` + `food_resolution_status = 'RESOLVED'`) is minted by resolving a name
 * against the food service, and no food service is in the loop here — writing one anyway would be a
 * fixture asserting a cross-service fact that never happened, and would give the seeded recipes a
 * nutrition identity nothing computed. So the seeded recipes are entirely user-entered, and the mobile
 * detail's REQ-034 USDA/custom-ingredient disclosure DOES render for them (asserted by
 * `packages/apps/commise/mobile/.maestro/recipes/list-detail.yaml`).
 *
 * ⛔ AND NO NUTRITION. `recipes.lead_calories_per_serving` / `has_partial_nutrition` and the
 * `ingredients.*_per_100g` columns were dropped in `migrations/0019_drop_duplicated_nutrition.sql`
 * (ADR-0021); `recipe_ingredients.user_calories` and its siblings are the USER's own overrides and stay
 * NULL here, because a fixture has no user to speak for and an invented figure is indistinguishable from
 * a measured one once it is on screen.
 *
 * Run with `npm run seed` (T097) against a `DATABASE_URL`; the migrations must already be applied.
 *
 * @sideEffect Connects to PostgreSQL and inserts rows.
 */
import pg from 'pg';

const { Pool } = pg;

/** The two stable owners the seed data belongs to (app-user ULIDs, not Clerk `sub`). */
export const SEED_OWNER_FREE = '01J0K6000000000000000000K6';
export const SEED_OWNER_PRO = '01J0PRO0000000000000000PRO';

/** A stable catalog ingredient (fixed uuid so re-seeding is a no-op). */
export interface SeedIngredient {
    readonly id: string;
    readonly name: string;
}

// ── The catalog ───────────────────────────────────────────────────────────────────────────────────
// Named consts, not inline literals: an ingredient LINE below references the catalog row itself, so a
// line's `ingredient_id` and its denormalized `ingredient_name` can never drift apart, and a typo is a
// compile error instead of a 23503 at seed time.

/**
 * ⚠️ Flour, Sugar and Butter are the catalog's PINNED, UNATTACHED trio, and both properties are load-bearing:
 *
 *   - POSITION — `__tests__/integration/recipes/ingredientsComposition.integration.test.ts` destructures
 *     `const [FLOUR, SUGAR] = SEED_INGREDIENTS`, so they must stay the first three, in this order.
 *     New rows are APPENDED.
 *   - UNATTACHED — `packages/apps/commise/mobile/.maestro/recipes/search-navigation.yaml` filters
 *     discovery by "Flour" and asserts the feed collapses to "No matching recipes". Attaching any of the
 *     three to a seed recipe turns that flow red. The five recipes below are built from the rows that
 *     follow instead.
 */
const FLOUR: SeedIngredient = { id: '00000000-0000-4000-8000-0000000000aa', name: 'Flour' };
const SUGAR: SeedIngredient = { id: '00000000-0000-4000-8000-0000000000bb', name: 'Sugar' };
const BUTTER: SeedIngredient = { id: '00000000-0000-4000-8000-0000000000cc', name: 'Butter' };

// Shared across several recipes.
const OLIVE_OIL: SeedIngredient = { id: '00000000-0000-4000-8000-000000000101', name: 'Olive oil' };
const GARLIC: SeedIngredient = { id: '00000000-0000-4000-8000-000000000102', name: 'Garlic' };
const LEMON: SeedIngredient = { id: '00000000-0000-4000-8000-000000000103', name: 'Lemon' };
const SEA_SALT: SeedIngredient = { id: '00000000-0000-4000-8000-000000000104', name: 'Sea salt' };

// Mediterranean Grilled Lamb.
const LAMB_CHOPS: SeedIngredient = { id: '00000000-0000-4000-8000-000000000105', name: 'Lamb loin chops' };
const OREGANO: SeedIngredient = { id: '00000000-0000-4000-8000-000000000106', name: 'Fresh oregano' };

// Asparagus with Green Sauce.
const ASPARAGUS: SeedIngredient = { id: '00000000-0000-4000-8000-000000000107', name: 'Asparagus' };
const PARSLEY: SeedIngredient = { id: '00000000-0000-4000-8000-000000000108', name: 'Flat-leaf parsley' };
const CAPERS: SeedIngredient = { id: '00000000-0000-4000-8000-000000000109', name: 'Capers' };

// Gourmet Garden Salad.
const SALAD_GREENS: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010a', name: 'Mixed salad greens' };
const CUCUMBER: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010b', name: 'Cucumber' };
const RED_WINE_VINEGAR: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010c', name: 'Red wine vinegar' };

// Herb Risotto.
const ARBORIO_RICE: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010d', name: 'Arborio rice' };
const VEGETABLE_STOCK: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010e', name: 'Vegetable stock' };
const PARMESAN: SeedIngredient = { id: '00000000-0000-4000-8000-00000000010f', name: 'Parmesan cheese' };
const CHIVES: SeedIngredient = { id: '00000000-0000-4000-8000-000000000110', name: 'Fresh chives' };

// Pan-Seared Duck.
const DUCK_BREAST: SeedIngredient = { id: '00000000-0000-4000-8000-000000000111', name: 'Duck breast' };
const HONEY: SeedIngredient = { id: '00000000-0000-4000-8000-000000000112', name: 'Honey' };
const BABY_CARROTS: SeedIngredient = { id: '00000000-0000-4000-8000-000000000113', name: 'Baby carrots' };
const THYME: SeedIngredient = { id: '00000000-0000-4000-8000-000000000114', name: 'Thyme' };

/**
 * The stable freeform ingredient catalog rows — the pinned trio first (see above), then the ingredients
 * the five seed recipes are actually made of.
 *
 * ⚠️ This list is also a RESTORE list: `__tests__/integration/ingredients/search.integration.test.ts`
 * wipes `ingredients` for its own isolation and rebuilds the seeded world from this module afterwards.
 * A catalog row defined anywhere else would be destroyed by that spec and never come back, and (with
 * `fileParallelism: false`) later specs would fail in file-order-dependent ways. There is exactly ONE
 * catalog const, and it is this one.
 *
 * Names must be case-insensitively unique: every row is `is_user_entered = true`, which is the partial
 * predicate of the UNIQUE `idx_ingredients_freeform_name` index on `lower(name)` (migration 0006).
 */
export const SEED_INGREDIENTS: readonly SeedIngredient[] = [
    FLOUR,
    SUGAR,
    BUTTER,
    OLIVE_OIL,
    GARLIC,
    LEMON,
    SEA_SALT,
    LAMB_CHOPS,
    OREGANO,
    ASPARAGUS,
    PARSLEY,
    CAPERS,
    SALAD_GREENS,
    CUCUMBER,
    RED_WINE_VINEGAR,
    ARBORIO_RICE,
    VEGETABLE_STOCK,
    PARMESAN,
    CHIVES,
    DUCK_BREAST,
    HONEY,
    BABY_CARROTS,
    THYME,
];

/** A stable seed recipe (fixed uuid so re-seeding is a no-op). */
export interface SeedRecipe {
    readonly id: string;
    readonly ownerId: string;
    readonly title: string;
    readonly description: string;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly totalTimeMinutes: number;
    readonly servings: number;
    readonly visibility: 'public' | 'private';
}

// Recipe ids are fixed v4-shaped uuids in a `…recipe000N` series, named so the lines and steps below
// reference the recipe itself rather than repeating its literal.
const LAMB_ID = '11111111-1111-4111-8111-111111111101';
const ASPARAGUS_ID = '11111111-1111-4111-8111-111111111102';
const SALAD_ID = '11111111-1111-4111-8111-111111111103';
const RISOTTO_ID = '11111111-1111-4111-8111-111111111104';
const DUCK_ID = '11111111-1111-4111-8111-111111111105';

/** The five deterministic seed recipes. */
export const SEED_RECIPES: readonly SeedRecipe[] = [
    {
        id: LAMB_ID,
        ownerId: SEED_OWNER_FREE,
        title: 'Mediterranean Grilled Lamb',
        description: 'Herb-marinated grilled lamb.',
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        servings: 4,
        visibility: 'private',
    },
    {
        id: ASPARAGUS_ID,
        ownerId: SEED_OWNER_FREE,
        title: 'Asparagus with Green Sauce',
        description: 'Blanched asparagus, herb sauce.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 10,
        totalTimeMinutes: 20,
        servings: 2,
        visibility: 'private',
    },
    {
        id: SALAD_ID,
        ownerId: SEED_OWNER_FREE,
        title: 'Gourmet Garden Salad',
        description: 'Seasonal greens, vinaigrette.',
        prepTimeMinutes: 15,
        cookTimeMinutes: 0,
        totalTimeMinutes: 15,
        servings: 2,
        visibility: 'public',
    },
    {
        id: RISOTTO_ID,
        ownerId: SEED_OWNER_PRO,
        title: 'Herb Risotto',
        description: 'Creamy risotto with fresh herbs.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
        totalTimeMinutes: 35,
        servings: 4,
        visibility: 'public',
    },
    {
        id: DUCK_ID,
        ownerId: SEED_OWNER_PRO,
        title: 'Pan-Seared Duck',
        description: 'Duck breast with seasonal vegetables.',
        prepTimeMinutes: 20,
        cookTimeMinutes: 40,
        totalTimeMinutes: 60,
        servings: 2,
        visibility: 'private',
    },
];

/**
 * One seeded `recipe_ingredients` row.
 *
 * `id` is fixed (`…{recipe}{line}`) for the same reason every other seed id is: `ON CONFLICT (id) DO
 * NOTHING` makes a re-seed a no-op. The junction has no other unique key, so its identity has to be the
 * primary key.
 */
export interface SeedRecipeIngredientLine {
    readonly id: string;
    readonly recipeId: string;
    /** The catalog row itself — the single source of both `ingredient_id` and `ingredient_name`. */
    readonly ingredient: SeedIngredient;
    readonly quantity: number;
    /**
     * `unit` is NOT NULL in the schema. `''` is the deliberate UNITLESS spelling ("1 lemon", "2 duck
     * breasts") — the database accepts it, the read projection turns it back into an ABSENT `unit` on the
     * wire, and it is the one shape the wire INPUT schema would reject, so seeding it keeps the read path
     * honest about a state the write path can still produce.
     */
    readonly unit: string;
}

/**
 * Every seeded ingredient line, grouped by recipe in author order — `sort_order` is a row's POSITION
 * within its recipe's slice, so the array order here is the order the detail screen renders.
 *
 * Exported so specs assert against ONE source of truth instead of restating quantities as literals.
 */
export const SEED_RECIPE_INGREDIENT_LINES: readonly SeedRecipeIngredientLine[] = [
    // Mediterranean Grilled Lamb (4 servings).
    { id: '33333333-3333-4333-8333-000000000101', recipeId: LAMB_ID, ingredient: LAMB_CHOPS, quantity: 8, unit: '' },
    { id: '33333333-3333-4333-8333-000000000102', recipeId: LAMB_ID, ingredient: OLIVE_OIL, quantity: 3, unit: 'tbsp' },
    { id: '33333333-3333-4333-8333-000000000103', recipeId: LAMB_ID, ingredient: GARLIC, quantity: 3, unit: 'clove' },
    { id: '33333333-3333-4333-8333-000000000104', recipeId: LAMB_ID, ingredient: OREGANO, quantity: 2, unit: 'tbsp' },
    { id: '33333333-3333-4333-8333-000000000105', recipeId: LAMB_ID, ingredient: LEMON, quantity: 1, unit: '' },

    // Asparagus with Green Sauce (2 servings).
    {
        id: '33333333-3333-4333-8333-000000000201',
        recipeId: ASPARAGUS_ID,
        ingredient: ASPARAGUS,
        quantity: 500,
        unit: 'g',
    },
    {
        id: '33333333-3333-4333-8333-000000000202',
        recipeId: ASPARAGUS_ID,
        ingredient: PARSLEY,
        quantity: 30,
        unit: 'g',
    },
    {
        id: '33333333-3333-4333-8333-000000000203',
        recipeId: ASPARAGUS_ID,
        ingredient: CAPERS,
        quantity: 1,
        unit: 'tbsp',
    },
    {
        id: '33333333-3333-4333-8333-000000000204',
        recipeId: ASPARAGUS_ID,
        ingredient: OLIVE_OIL,
        quantity: 4,
        unit: 'tbsp',
    },
    { id: '33333333-3333-4333-8333-000000000205', recipeId: ASPARAGUS_ID, ingredient: LEMON, quantity: 1, unit: '' },

    // Gourmet Garden Salad (2 servings, no cooking).
    {
        id: '33333333-3333-4333-8333-000000000301',
        recipeId: SALAD_ID,
        ingredient: SALAD_GREENS,
        quantity: 150,
        unit: 'g',
    },
    { id: '33333333-3333-4333-8333-000000000302', recipeId: SALAD_ID, ingredient: CUCUMBER, quantity: 1, unit: '' },
    {
        id: '33333333-3333-4333-8333-000000000303',
        recipeId: SALAD_ID,
        ingredient: RED_WINE_VINEGAR,
        quantity: 1,
        unit: 'tbsp',
    },
    {
        id: '33333333-3333-4333-8333-000000000304',
        recipeId: SALAD_ID,
        ingredient: OLIVE_OIL,
        quantity: 3,
        unit: 'tbsp',
    },
    { id: '33333333-3333-4333-8333-000000000305', recipeId: SALAD_ID, ingredient: SEA_SALT, quantity: 1, unit: 'tsp' },

    // Herb Risotto (4 servings).
    {
        id: '33333333-3333-4333-8333-000000000401',
        recipeId: RISOTTO_ID,
        ingredient: ARBORIO_RICE,
        quantity: 320,
        unit: 'g',
    },
    {
        id: '33333333-3333-4333-8333-000000000402',
        recipeId: RISOTTO_ID,
        ingredient: VEGETABLE_STOCK,
        quantity: 1.2,
        unit: 'l',
    },
    {
        id: '33333333-3333-4333-8333-000000000403',
        recipeId: RISOTTO_ID,
        ingredient: PARMESAN,
        quantity: 60,
        unit: 'g',
    },
    {
        id: '33333333-3333-4333-8333-000000000404',
        recipeId: RISOTTO_ID,
        ingredient: CHIVES,
        quantity: 2,
        unit: 'tbsp',
    },
    {
        id: '33333333-3333-4333-8333-000000000405',
        recipeId: RISOTTO_ID,
        ingredient: OLIVE_OIL,
        quantity: 2,
        unit: 'tbsp',
    },

    // Pan-Seared Duck (2 servings).
    { id: '33333333-3333-4333-8333-000000000501', recipeId: DUCK_ID, ingredient: DUCK_BREAST, quantity: 2, unit: '' },
    { id: '33333333-3333-4333-8333-000000000502', recipeId: DUCK_ID, ingredient: SEA_SALT, quantity: 1, unit: 'tsp' },
    {
        id: '33333333-3333-4333-8333-000000000503',
        recipeId: DUCK_ID,
        ingredient: BABY_CARROTS,
        quantity: 250,
        unit: 'g',
    },
    { id: '33333333-3333-4333-8333-000000000504', recipeId: DUCK_ID, ingredient: THYME, quantity: 4, unit: 'sprig' },
    { id: '33333333-3333-4333-8333-000000000505', recipeId: DUCK_ID, ingredient: HONEY, quantity: 1, unit: 'tbsp' },
];

/**
 * One seeded `recipe_steps` row. There is no `id` here on purpose: `recipe_steps` already declares the
 * step's real identity — `UNIQUE (recipe_id, step_number)` — so the insert dedups on the constraint the
 * schema owns instead of on a uuid this fixture would have to invent and keep unique by hand.
 */
export interface SeedRecipeStep {
    readonly recipeId: string;
    /** 1-based and contiguous (`CHECK (step_number > 0)`, and the detail's "Mark step 1 complete" tap). */
    readonly stepNumber: number;
    readonly instruction: string;
    /** Optional countdown (`CHECK (timer_seconds > 0)`). Absent where a step is not time-bound. */
    readonly timerSeconds?: number;
}

/** Every seeded step, in `stepNumber` order within each recipe. */
export const SEED_RECIPE_STEPS: readonly SeedRecipeStep[] = [
    // Mediterranean Grilled Lamb.
    {
        recipeId: LAMB_ID,
        stepNumber: 1,
        instruction: 'Whisk the olive oil, crushed garlic, chopped oregano and the juice of the lemon into a marinade.',
    },
    {
        recipeId: LAMB_ID,
        stepNumber: 2,
        instruction: 'Coat the chops in the marinade and leave them to stand at room temperature.',
        timerSeconds: 1800,
    },
    {
        recipeId: LAMB_ID,
        stepNumber: 3,
        instruction: 'Grill the chops over high heat, turning once, until charred outside and pink at the bone.',
        timerSeconds: 480,
    },
    {
        recipeId: LAMB_ID,
        stepNumber: 4,
        instruction: 'Rest the chops loosely covered before serving.',
        timerSeconds: 300,
    },

    // Asparagus with Green Sauce.
    {
        recipeId: ASPARAGUS_ID,
        stepNumber: 1,
        instruction: 'Snap the woody ends off the asparagus spears and discard them.',
    },
    {
        recipeId: ASPARAGUS_ID,
        stepNumber: 2,
        instruction: 'Blanch the spears in salted boiling water, then drop them straight into iced water.',
        timerSeconds: 180,
    },
    {
        recipeId: ASPARAGUS_ID,
        stepNumber: 3,
        instruction: 'Blend the parsley, capers, olive oil and lemon juice into a loose green sauce.',
    },
    {
        recipeId: ASPARAGUS_ID,
        stepNumber: 4,
        instruction: 'Drain the spears well and spoon the green sauce over them.',
    },

    // Gourmet Garden Salad.
    {
        recipeId: SALAD_ID,
        stepNumber: 1,
        instruction: 'Wash and dry the salad greens, then tear them into a wide serving bowl.',
    },
    {
        recipeId: SALAD_ID,
        stepNumber: 2,
        instruction: 'Shave the cucumber into ribbons and scatter them over the greens.',
    },
    {
        recipeId: SALAD_ID,
        stepNumber: 3,
        instruction:
            'Whisk the olive oil, red wine vinegar and sea salt into a vinaigrette and dress the salad just before serving.',
    },

    // Herb Risotto.
    {
        recipeId: RISOTTO_ID,
        stepNumber: 1,
        instruction: 'Bring the vegetable stock to a bare simmer and keep it beside the pan.',
    },
    {
        recipeId: RISOTTO_ID,
        stepNumber: 2,
        instruction: 'Toast the arborio rice in the olive oil until the grains turn translucent at the edges.',
        timerSeconds: 120,
    },
    {
        recipeId: RISOTTO_ID,
        stepNumber: 3,
        instruction: 'Add the stock a ladle at a time, stirring, until the rice is creamy and just al dente.',
        timerSeconds: 1080,
    },
    {
        recipeId: RISOTTO_ID,
        stepNumber: 4,
        instruction: 'Beat in the parmesan and chives off the heat, then let the risotto settle before serving.',
        timerSeconds: 120,
    },

    // Pan-Seared Duck.
    {
        recipeId: DUCK_ID,
        stepNumber: 1,
        instruction: 'Score the duck skin in a diamond pattern and season it well with the sea salt.',
    },
    {
        recipeId: DUCK_ID,
        stepNumber: 2,
        instruction: 'Lay the breasts skin-down in a cold pan and render over medium heat until the skin is crisp.',
        timerSeconds: 720,
    },
    {
        recipeId: DUCK_ID,
        stepNumber: 3,
        instruction: 'Turn the breasts, sear the flesh side, then rest them under foil.',
        timerSeconds: 240,
    },
    {
        recipeId: DUCK_ID,
        stepNumber: 4,
        instruction: 'Toss the baby carrots and thyme in the rendered fat with the honey and roast until glazed.',
        timerSeconds: 900,
    },
];

/** The one deterministic seed collection (owned by the pro subject, holds the two pro recipes). */
export const SEED_COLLECTION = {
    id: '22222222-2222-4222-8222-222222222201',
    ownerId: SEED_OWNER_PRO,
    name: 'Weeknight Favorites',
    recipeIds: [RISOTTO_ID, DUCK_ID],
} as const;

/**
 * The `recipes.ingredient_names_text` value for a seeded recipe: its catalog ingredient names, in line
 * order, joined by a single space.
 *
 * ⚠️ This column is NOT maintained by the database. It is the weight-C input of the
 * `trg_recipes_search_vector` trigger (`migrations/0001_initial.sql`), and the trigger only re-runs the
 * whole vector — it never derives this column. A seed that left it at its `DEFAULT ''` would produce
 * recipes that are invisible to ingredient-name search while every existing test stayed green, because
 * nothing else reads it.
 *
 * The format MIRRORS the service's own `buildIngredientNamesText` (`src/recipes/recipes.service.ts`),
 * which is what fills this column on the write path: the RESOLVED catalog names, trimmed, empties
 * dropped, space-joined. That function is module-private to the recipes vertical, so this is a
 * deliberate second implementation of one format; `src/database/__tests__/seed.test.ts` pins the exact
 * string so a drift fails loudly here rather than silently as an unfindable recipe.
 *
 * @param recipeId - The seed recipe whose lines to join.
 * @returns The space-joined ingredient names (`''` if the recipe has no lines). Pure.
 */
export function seedIngredientNamesText(recipeId: string): string {
    return SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === recipeId)
        .map((line) => line.ingredient.name.trim())
        .filter((name) => name.length > 0)
        .join(' ');
}

/** Counts of rows inserted by one {@link seed} run (already-present rows are skipped, not counted). */
export interface SeedCounts {
    ingredients: number;
    recipes: number;
    /**
     * Existing recipe rows whose empty `ingredient_names_text` was refilled — NOT insertions. Counted
     * (and logged) separately so the summary never reports a repair as a fresh row. See {@link seed}.
     */
    recipesRepaired: number;
    recipeIngredients: number;
    recipeSteps: number;
    collections: number;
    memberships: number;
}

/**
 * Insert the deterministic seed data idempotently against a pool.
 *
 * @param pool - A connected `pg` pool to the target recipe database.
 * @returns Counts of rows inserted this run (already-present rows are skipped, not counted).
 * @sideEffect Executes INSERTs.
 */
export async function seed(pool: pg.Pool): Promise<SeedCounts> {
    const counts: SeedCounts = {
        ingredients: 0,
        recipes: 0,
        recipesRepaired: 0,
        recipeIngredients: 0,
        recipeSteps: 0,
        collections: 0,
        memberships: 0,
    };

    // Catalog first: recipe create/update validates each line's `ingredientId` against these rows (T043b),
    // and the junction rows below carry an FK to them. `search_vector` is populated the same way the
    // IngredientsDal does on a freeform insert — `ingredients` has NO trigger, writers set it themselves.
    for (const ingredient of SEED_INGREDIENTS) {
        const res = await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered, search_vector)
             VALUES ($1, $2, true, to_tsvector('english', $2))
             ON CONFLICT (id) DO NOTHING`,
            [ingredient.id, ingredient.name],
        );
        counts.ingredients += res.rowCount ?? 0;
    }

    for (const r of SEED_RECIPES) {
        const ingredientNamesText = seedIngredientNamesText(r.id);

        const res = await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                 total_time_minutes, servings, visibility, ingredient_names_text)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (id) DO NOTHING`,
            [
                r.id,
                r.ownerId,
                r.title,
                r.description,
                r.prepTimeMinutes,
                r.cookTimeMinutes,
                r.totalTimeMinutes,
                r.servings,
                r.visibility,
                // Written in the SAME statement as the row: `trg_recipes_search_vector` fires BEFORE INSERT,
                // so the vector is built with the weight-C names from the very first write.
                ingredientNamesText,
            ],
        );
        counts.recipes += res.rowCount ?? 0;

        // ⚠️ REPAIR, not a re-write. `ON CONFLICT (id) DO NOTHING` is right for the row, but it is a trap
        // for a DERIVED column: a database seeded BEFORE this fixture had ingredient lines keeps its recipe
        // rows (skipped forever) with `ingredient_names_text` at its `DEFAULT ''`, while the lines and steps
        // below DO get inserted. The result is silent — the recipes look complete and are unfindable by any
        // of their own ingredients, and nothing else reads the column. Observed on a real long-lived local
        // database, and reproduced by the integration spec.
        //
        // Scoped to the EMPTY default on purpose: it restores only what an older seed never wrote, and can
        // never overwrite a value the service wrote for a seed recipe someone has since edited. It is also
        // skipped entirely for a recipe that genuinely has no lines, so it can never count itself as work.
        if (ingredientNamesText.length > 0) {
            const repair = await pool.query(
                `UPDATE recipes SET ingredient_names_text = $2 WHERE id = $1 AND ingredient_names_text = ''`,
                [r.id, ingredientNamesText],
            );
            counts.recipesRepaired += repair.rowCount ?? 0;
        }
    }

    for (const r of SEED_RECIPES) {
        const lines = SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === r.id);

        for (const [index, line] of lines.entries()) {
            const res = await pool.query(
                `INSERT INTO recipe_ingredients
                     (id, recipe_id, ingredient_id, quantity, unit, sort_order, ingredient_name, is_user_entered)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,true)
                 ON CONFLICT (id) DO NOTHING`,
                // `sort_order` is the line's POSITION in its recipe's slice — array order is author order.
                // `user_calories` and its siblings stay NULL: they are the USER's overrides (see the module
                // header), not something a fixture may invent.
                [line.id, line.recipeId, line.ingredient.id, line.quantity, line.unit, index, line.ingredient.name],
            );
            counts.recipeIngredients += res.rowCount ?? 0;
        }
    }

    for (const step of SEED_RECIPE_STEPS) {
        const res = await pool.query(
            `INSERT INTO recipe_steps (recipe_id, step_number, instruction, timer_seconds)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            // Untargeted `ON CONFLICT`: the step's identity is the UNIQUE (recipe_id, step_number) the
            // schema declares, and its `id` is a server-generated uuid, so there is no single conflict
            // target that covers a re-seed.
            [step.recipeId, step.stepNumber, step.instruction, step.timerSeconds ?? null],
        );
        counts.recipeSteps += res.rowCount ?? 0;
    }

    const col = await pool.query(
        `INSERT INTO collections (id, owner_id, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [SEED_COLLECTION.id, SEED_COLLECTION.ownerId, SEED_COLLECTION.name],
    );
    counts.collections += col.rowCount ?? 0;

    for (const recipeId of SEED_COLLECTION.recipeIds) {
        const mem = await pool.query(
            `INSERT INTO recipe_collections (collection_id, recipe_id, added_via)
             VALUES ($1,$2,'manual')
             ON CONFLICT (collection_id, recipe_id) DO NOTHING`,
            [SEED_COLLECTION.id, recipeId],
        );
        counts.memberships += mem.rowCount ?? 0;
    }

    return counts;
}

/**
 * CLI entrypoint (`npm run seed`). Reads `DATABASE_URL`, seeds, logs a summary, exits non-zero on error.
 *
 * @sideEffect Connects to PostgreSQL, inserts, and writes to the console.
 */
export async function main(): Promise<void> {
    const connectionString = process.env['DATABASE_URL'];

    if (!connectionString) {
        throw new Error('seed: DATABASE_URL is required.');
    }

    const pool = new Pool({ connectionString });

    try {
        const counts = await seed(pool);
        console.log(
            `seed: inserted ${counts.ingredients} ingredients, ${counts.recipes} recipes, ` +
                `${counts.recipeIngredients} ingredient lines, ${counts.recipeSteps} steps, ` +
                `${counts.collections} collections, ${counts.memberships} memberships ` +
                `(already-present rows skipped); repaired ${counts.recipesRepaired} empty ingredient_names_text.`,
        );
    } finally {
        await pool.end();
    }
}

// Run when invoked directly (tsx src/database/seed.ts), not when imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exitCode = 1;
    });
}
