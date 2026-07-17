/**
 * Deterministic E2E/dev seed (T096): a fixed catalog of ingredients + a fixed set of recipes + one
 * collection owned by two stable test subjects (a free-tier and a pro-tier Clerk subject), keyed by
 * `owner_id`. There is NO `users` table to seed (D2) — ownership is the app-user ULID carried on the
 * token. Idempotent via stable ids + `ON CONFLICT (id) DO NOTHING`, so it is safe to run on every
 * deploy / test boot.
 *
 * This module is the ONE authoritative definition of "the seeded world" (T097): `tests/global-setup.ts`
 * calls {@link seed} and re-exports {@link SEED_INGREDIENTS} for the specs that reference the catalog, so
 * there is a single source of truth rather than a divergent hand-rolled baseline.
 *
 * The ingredient catalog is load-bearing: since T043b, recipe create/update validates every line's
 * `ingredientId` against it, so the integration/e2e specs that build recipes referencing these ids
 * depend on these rows existing.
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

/**
 * The stable freeform ingredient catalog rows. Integration/e2e specs attach these to recipes by id and
 * the composition spec reads them back by name — so both the ORDER (`[Flour, Sugar, Butter]`) and the
 * names are part of the contract those specs assert against.
 */
export const SEED_INGREDIENTS: readonly SeedIngredient[] = [
    { id: '00000000-0000-4000-8000-0000000000aa', name: 'Flour' },
    { id: '00000000-0000-4000-8000-0000000000bb', name: 'Sugar' },
    { id: '00000000-0000-4000-8000-0000000000cc', name: 'Butter' },
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

/** The five deterministic seed recipes (ids are fixed v4-shaped uuids in a `…recipe000N` series). */
export const SEED_RECIPES: readonly SeedRecipe[] = [
    {
        id: '11111111-1111-4111-8111-111111111101',
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
        id: '11111111-1111-4111-8111-111111111102',
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
        id: '11111111-1111-4111-8111-111111111103',
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
        id: '11111111-1111-4111-8111-111111111104',
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
        id: '11111111-1111-4111-8111-111111111105',
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

/** The one deterministic seed collection (owned by the pro subject, holds the two pro recipes). */
export const SEED_COLLECTION = {
    id: '22222222-2222-4222-8222-222222222201',
    ownerId: SEED_OWNER_PRO,
    name: 'Weeknight Favorites',
    recipeIds: ['11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111105'],
} as const;

/**
 * Insert the deterministic seed data idempotently against a pool.
 *
 * @param pool - A connected `pg` pool to the target recipe database.
 * @returns Counts of rows inserted this run (already-present rows are skipped, not counted).
 * @sideEffect Executes INSERTs.
 */
export async function seed(
    pool: pg.Pool,
): Promise<{ ingredients: number; recipes: number; collections: number; memberships: number }> {
    let ingredients = 0;
    let recipes = 0;
    let collections = 0;
    let memberships = 0;

    // Catalog first: recipe create/update validates each line's `ingredientId` against these rows (T043b).
    // `search_vector` is populated the same way the IngredientsDal does on a freeform insert.
    for (const ingredient of SEED_INGREDIENTS) {
        const res = await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered, search_vector)
             VALUES ($1, $2, true, to_tsvector('english', $2))
             ON CONFLICT (id) DO NOTHING`,
            [ingredient.id, ingredient.name],
        );
        ingredients += res.rowCount ?? 0;
    }

    for (const r of SEED_RECIPES) {
        const res = await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                 total_time_minutes, servings, visibility)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
            ],
        );
        recipes += res.rowCount ?? 0;

        // Give each recipe two catalog-linked ingredients and two steps so it is a COMPLETE, editable record:
        // the editor's validation requires >= 1 ingredient AND >= 1 step to save, so a recipe seeded without
        // them cannot be edited at all (FR-001/FR-007). Gated on a FRESH insert (rowCount) to stay idempotent
        // — a re-seed over existing recipes skips both the recipe and its children rather than duplicating.
        if (res.rowCount) {
            await pool.query(
                `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, sort_order, ingredient_name)
                 VALUES ($1, $2, 1, 'cup', 0, 'Flour'),
                        ($1, $3, 2, 'tbsp', 1, 'Butter')`,
                [r.id, SEED_INGREDIENTS[0]?.id, SEED_INGREDIENTS[2]?.id],
            );
            await pool.query(
                `INSERT INTO recipe_steps (recipe_id, step_number, instruction)
                 VALUES ($1, 1, 'Combine the ingredients in a bowl.'),
                        ($1, 2, 'Cook until done, then plate and serve.')
                 ON CONFLICT (recipe_id, step_number) DO NOTHING`,
                [r.id],
            );
        }
    }

    const col = await pool.query(
        `INSERT INTO collections (id, owner_id, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [SEED_COLLECTION.id, SEED_COLLECTION.ownerId, SEED_COLLECTION.name],
    );
    collections += col.rowCount ?? 0;

    for (const recipeId of SEED_COLLECTION.recipeIds) {
        const mem = await pool.query(
            `INSERT INTO recipe_collections (collection_id, recipe_id, added_via)
             VALUES ($1,$2,'manual')
             ON CONFLICT (collection_id, recipe_id) DO NOTHING`,
            [SEED_COLLECTION.id, recipeId],
        );
        memberships += mem.rowCount ?? 0;
    }

    return { ingredients, recipes, collections, memberships };
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
            `seed: inserted ${counts.ingredients} ingredients, ${counts.recipes} recipes, ${counts.collections} collections, ${counts.memberships} memberships (already-present rows skipped).`,
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
