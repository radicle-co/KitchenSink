/**
 * Migration `0025_ingredient_rank_terms.sql`, and the ONE assertion that keeps two implementations of one
 * rule honest (plan U5/U6).
 *
 * ## ⛔ Why this tier is mandatory, and why nothing else can stand in for it
 *
 * `foldForRanking` and `rankingTokens` exist twice: once in TypeScript
 * (`@kitchensink/recipe-core/resolution/ranking-terms`), where the query side is computed and the tier
 * ladder is unit-tested, and once as two STORED generated columns, where the ROW side is computed. Nothing
 * in the type system links them. Two regex engines with different dialects, a locale-dependent
 * `[[:alnum:]]` against a Unicode `\p{L}`, a `lower()` that answers to the database collation — every one of
 * those is a place the two can silently disagree, and a disagreement shows up only as a row ranked wrongly
 * in production.
 *
 * So this suite asks the database for its answer and compares it, value by value, with TypeScript's. A unit
 * test cannot: it has no Postgres. The ordering suites cannot either — they would only notice a divergence
 * that happened to change the order of their particular fixture.
 *
 * ⚠️ This file is the MIRROR of food-service's `tests/rankingTerms.integration.test.ts`, against
 * `ingredients` instead of `food`. Both must exist: the two migrations are separate files against separate
 * databases, and the whole point is that a rule change reaching only one of them fails on the other.
 *
 * ## Mutation lens
 *
 * Every case fails if either expression drifts from `rankingTerms.ts`: a dropped `normalize`, `[[:space:]]`
 * instead of the explicit ASCII class, `[^s]` instead of `(?!s)[[:alnum:]]` in the plural arm, a missing
 * `array_remove`, or the columns silently not being GENERATED at all (which would leave them NULL forever
 * and make every rung fall through to `base`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { foldForRanking, rankingTokens } from '@kitchensink/recipe-core/resolution/ranking-terms';

import { seed } from '../../../src/database/seed.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/**
 * Names chosen because each one can distinguish the two implementations — a diacritic, a hyphen, a comma, a
 * percentage, every arm of the plural rule, a word the rule over-folds, an all-punctuation name, and a pair
 * that would trip a plural rule written with `[^s]` instead of a lookahead.
 */
const TRAILING_ID = '00000000-0000-4000-8000-000000009001';

/** A distinct id for the rename case, so it never collides with the corpus above. */
const RENAME_ID = '00000000-0000-4000-8000-000000009002';

const NAMES: readonly string[] = [
    'Flour',
    'Carob flour',
    'Flour, wheat, all-purpose, enriched',
    'Sugars, brown',
    'Vinegar, red wine',
    'Egg, whole, raw',
    'Chives, freeze-dried',
    'Peppers, jalapeño, raw',
    'Crème Brûlée',
    'Milk, whole, 3.25% milkfat',
    'Candies, sugar-coated almonds',
    'Molasses',
    'Glass noodles',
    'Peaches, canned in juice',
    'Boxes of dishes',
    'ab s',
    '  Butter  ',
    'Flour,',
    '2% milk',
    'salt & pepper',
    '---',
    'GAS',
];

describe.skipIf(!DATABASE_URL)('ingredients.rank_folded / rank_tokens (migration 0024, integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterAll(async () => {
        // This suite wipes `ingredients`, which every other integration spec validates recipe lines against
        // (T043b). `seed` restores the whole seeded world and is idempotent.
        //
        // ⛔ WIPE FIRST, then seed — see the same note in `ingredientRanking.integration.test.ts`. The
        // seed's `ON CONFLICT` is keyed on `id` and cannot absorb a collision on
        // `idx_ingredients_freeform_name` (`lower(name)`), so any fixture row left behind here raises
        // inside the seed and breaks the world for every spec that runs after this one.
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
        await seed(pool);
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
    });

    it('the migration applied — both columns exist and are GENERATED', async () => {
        const { rows } = await pool.query<{ column_name: string; is_generated: string; data_type: string }>(
            `SELECT column_name, is_generated, data_type
             FROM information_schema.columns
             WHERE table_name = 'ingredients' AND column_name IN ('rank_folded', 'rank_tokens')
             ORDER BY column_name`,
        );

        // ⚠️ `is_generated` is the assertion that matters. A plain nullable column of the same name and type
        // would leave every row NULL, every rung would fall through to `base`, and the ladder would be inert
        // while every statement-shape test still passed.
        expect(rows).toEqual([
            { column_name: 'rank_folded', is_generated: 'ALWAYS', data_type: 'text' },
            { column_name: 'rank_tokens', is_generated: 'ALWAYS', data_type: 'ARRAY' },
        ]);
    });

    it('⛔ computes EXACTLY what `foldForRanking` and `rankingTokens` compute, for every name', async () => {
        for (const [index, name] of NAMES.entries()) {
            await pool.query(
                `INSERT INTO ingredients (id, name, is_user_entered, search_vector)
                 VALUES ($1, $2, true, to_tsvector('english', $2))`,
                [`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name],
            );
        }

        const { rows } = await pool.query<{ name: string; rank_folded: string; rank_tokens: string[] }>(
            'SELECT name, rank_folded, rank_tokens FROM ingredients ORDER BY id',
        );

        // One comparison per name, reported all at once: a divergence in the fold shifts many rows, and
        // failing on the first turns one systematic defect into a dozen debugging rounds.
        const divergences = rows
            .map((row) => ({
                name: row.name,
                sql: { folded: row.rank_folded, tokens: row.rank_tokens },
                ts: { folded: foldForRanking(row.name), tokens: [...rankingTokens(row.name)] },
            }))
            .filter(
                (entry) =>
                    entry.sql.folded !== entry.ts.folded ||
                    JSON.stringify(entry.sql.tokens) !== JSON.stringify(entry.ts.tokens),
            );

        expect(divergences).toEqual([]);
        expect(rows).toHaveLength(NAMES.length);
    });

    it('never stores an empty token, so a name ending in punctuation can still reach the token-set rung', async () => {
        // Without `array_remove(..., '')`, `regexp_split_to_array('flour,', …)` yields `{flour,""}` — and no
        // query's token array contains the empty string, so `rank_tokens <@ $query` could never hold.
        await pool.query(`INSERT INTO ingredients (id, name, is_user_entered) VALUES ($1, 'Flour,', true)`, [
            TRAILING_ID,
        ]);

        const { rows } = await pool.query<{ rank_tokens: string[] }>(
            'SELECT rank_tokens FROM ingredients WHERE id = $1',
            [TRAILING_ID],
        );

        expect(rows[0]!.rank_tokens).toEqual(['flour']);
    });

    it('recomputes on UPDATE, because Postgres owns the value and no writer can forget it', async () => {
        // ⚠️ This is exactly what U3's `updateResolution` rename does: the ranking terms follow the golden
        // name for free, where `search_vector` has to be recomputed by hand in the same statement.
        await pool.query(`INSERT INTO ingredients (id, name, is_user_entered) VALUES ($1, 'Carob flour', true)`, [
            RENAME_ID,
        ]);
        await pool.query("UPDATE ingredients SET name = 'Flour, wheat' WHERE id = $1", [RENAME_ID]);

        const { rows } = await pool.query<{ rank_folded: string; rank_tokens: string[] }>(
            'SELECT rank_folded, rank_tokens FROM ingredients WHERE id = $1',
            [RENAME_ID],
        );

        expect(rows[0]!.rank_folded).toBe(foldForRanking('Flour, wheat'));
        expect(rows[0]!.rank_tokens).toEqual([...rankingTokens('Flour, wheat')]);
    });

    it('⛔ has no nameless case, because `ingredients.name` is NOT NULL', async () => {
        // food-service's mirror asserts NULL terms for a nameless row. Here that state is unrepresentable,
        // and asserting it would be asserting a fiction — so the invariant is asserted instead.
        const { rows } = await pool.query<{ is_nullable: string }>(
            `SELECT is_nullable FROM information_schema.columns
             WHERE table_name = 'ingredients' AND column_name = 'name'`,
        );

        expect(rows[0]!.is_nullable).toBe('NO');
    });
});
