/**
 * U1 — `ingredients.rank_head`, asserted against a real Docker PostgreSQL (migration 0034).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a migration that did not run, and this column
 * is a GENERATED mirror of `describeRankingName(name).head` — the whole point is that Postgres and
 * TypeScript compute the SAME head from the same name, byte for byte, or the head rung the SQL sorts by
 * and the head rung the TypeScript ladder classifies drift apart invisibly. The parity loop below is the
 * only place that agreement is observable.
 *
 * The rule under test (plan U1, D4b): a name with a comma whose FIRST SEGMENT is multi-word takes that
 * segment's LAST token as its head (`Cinnamon buns, frosted` → `bun` — the measured false catch); every
 * other name keeps its FIRST token (`Carob flour` → `carob`, deliberately, in both directions).
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips rather than
 * fails, matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { describeRankingName } from '@kitchensink/recipe-core/resolution/ranking-terms';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** A uuid prefix unique to this suite (`ingredients.id` is uuid), so cleanup never touches other specs. */
const ID_PREFIX = 'aaaa0001-0000-4000-8000-';
const idOf = (index: number): string => `${ID_PREFIX}${String(index).padStart(12, '0')}`;

/** Names that distinguish the two implementations on every arm of the head rule. */
const NAMES: readonly string[] = [
    'Cinnamon buns, frosted',
    'Salad dressing, russian',
    'Pepper, banana, raw',
    'Flour, wheat, all-purpose',
    'Carob flour',
    'Milk and cereal bar',
    'Vinegar, red wine',
    'Sugars, brown',
    ', frosted',
    'Peppers, jalapeño, raw',
    '---',
];

describe.skipIf(!hasDatabaseUrl)('ingredients.rank_head (migration 0034)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredients WHERE id::text LIKE $1', [`${ID_PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE id::text LIKE $1', [`${ID_PREFIX}%`]);
        await pool.end();
    });

    it('the column exists and is GENERATED', async () => {
        const { rows } = await pool.query(
            `SELECT is_generated FROM information_schema.columns
             WHERE table_name = 'ingredients' AND column_name = 'rank_head'`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].is_generated).toBe('ALWAYS');
    });

    it('⛔ computes EXACTLY what describeRankingName().head computes, for every name', async () => {
        for (const [index, name] of NAMES.entries()) {
            await pool.query(`INSERT INTO ingredients (id, name, is_user_entered) VALUES ($1, $2, true)`, [
                idOf(index),
                name,
            ]);
        }

        const { rows } = await pool.query(`SELECT name, rank_head FROM ingredients WHERE id::text LIKE $1`, [
            `${ID_PREFIX}%`,
        ]);

        expect(rows).toHaveLength(NAMES.length);

        for (const row of rows) {
            expect(row.rank_head ?? undefined, `head of ${JSON.stringify(row.name)}`).toBe(
                describeRankingName(row.name).head,
            );
        }
    });
});
