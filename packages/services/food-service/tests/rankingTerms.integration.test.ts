/**
 * Migration `0008_food_rank_terms.sql`, and the ONE assertion that keeps two implementations of one rule
 * honest (plan U5).
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
 * ## Mutation lens
 *
 * Every case fails if either expression drifts from `rankingTerms.ts`: a dropped `normalize`, `[[:space:]]`
 * instead of the explicit ASCII class, `[^s]` instead of `(?!s)[[:alnum:]]` in the plural arm, a missing
 * `array_remove`, or the columns silently not being GENERATED at all (which would leave them NULL forever
 * and make every rung fall through to `base`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { describeRankingName, foldForRanking, rankingTokens } from '@kitchensink/recipe-core/resolution/ranking-terms';

import { DATABASE_URL, makePool, resetSchema } from './support/db.js';

/**
 * Names chosen because each one can distinguish the two implementations — a diacritic, a hyphen, a comma, a
 * percentage, every arm of the plural rule, a word the rule over-folds, an all-punctuation name, and a pair
 * that would trip a plural rule written with `[^s]` instead of a lookahead.
 */
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

describe.skipIf(!DATABASE_URL)('food.rank_folded / rank_tokens (migration 0008, integration)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food CASCADE');
    });

    describe('food.rank_head (migration 0011) mirrors the comma-segment head rule (plan U1, D4b)', () => {
        it('the column exists, is GENERATED, and is STORED', async () => {
            const { rows } = await pool.query(
                `SELECT is_generated FROM information_schema.columns
                 WHERE table_name = 'food' AND column_name = 'rank_head'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0].is_generated).toBe('ALWAYS');
        });

        it('⛔ computes EXACTLY what describeRankingName().head computes, for every name', async () => {
            for (const name of [...NAMES, 'Cinnamon buns, frosted', 'Salad dressing, russian', ', frosted']) {
                await pool.query(
                    `INSERT INTO food (id, name, normalized_name, status)
                     VALUES (gen_random_uuid()::text, $1, $1 || '-' || gen_random_uuid()::text, 'RESOLVED')`,
                    [name],
                );
            }

            const { rows } = await pool.query('SELECT name, rank_head FROM food');

            for (const row of rows) {
                expect(row.rank_head ?? undefined, `head of ${JSON.stringify(row.name)}`).toBe(
                    describeRankingName(row.name).head,
                );
            }
        });

        it('crowns the noun of a natural-order first segment — the measured cinnamon case', async () => {
            await pool.query(
                `INSERT INTO food (id, name, normalized_name, status)
                 VALUES ('u1-cinnamon', 'Cinnamon buns, frosted', 'u1-cinnamon', 'RESOLVED')`,
            );

            const { rows } = await pool.query(`SELECT rank_head FROM food WHERE id = 'u1-cinnamon'`);

            expect(rows[0].rank_head).toBe('bun');
        });
    });

    it('the migration applied — both columns exist and are GENERATED', async () => {
        const { rows } = await pool.query<{ column_name: string; is_generated: string; data_type: string }>(
            `SELECT column_name, is_generated, data_type
             FROM information_schema.columns
             WHERE table_name = 'food' AND column_name IN ('rank_folded', 'rank_tokens')
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
                `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, lower($2), 'RESOLVED')`,
                [`rank-${String(index).padStart(4, '0')}`, name],
            );
        }

        const { rows } = await pool.query<{ name: string; rank_folded: string; rank_tokens: string[] }>(
            'SELECT name, rank_folded, rank_tokens FROM food ORDER BY id',
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
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ('trailing', 'Flour,', 'flour,', 'RESOLVED')`,
        );

        const { rows } = await pool.query<{ rank_tokens: string[] }>(
            "SELECT rank_tokens FROM food WHERE id = 'trailing'",
        );

        expect(rows[0]!.rank_tokens).toEqual(['flour']);
    });

    it('recomputes on UPDATE, because Postgres owns the value and no writer can forget it', async () => {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ('rename', 'Carob flour', 'carob flour', 'RESOLVED')`,
        );
        await pool.query("UPDATE food SET name = 'Flour, wheat' WHERE id = 'rename'");

        const { rows } = await pool.query<{ rank_folded: string; rank_tokens: string[] }>(
            "SELECT rank_folded, rank_tokens FROM food WHERE id = 'rename'",
        );

        expect(rows[0]!.rank_folded).toBe(foldForRanking('Flour, wheat'));
        expect(rows[0]!.rank_tokens).toEqual([...rankingTokens('Flour, wheat')]);
    });

    it('holds NULL for a nameless row rather than an empty string (GR-019: no sentinels)', async () => {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ('nameless', NULL, 'nameless', 'PENDING')`,
        );

        const { rows } = await pool.query<{ rank_folded: string | null; rank_tokens: string[] | null }>(
            "SELECT rank_folded, rank_tokens FROM food WHERE id = 'nameless'",
        );

        expect(rows[0]!.rank_folded).toBeNull();
        expect(rows[0]!.rank_tokens).toBeNull();
    });
});
