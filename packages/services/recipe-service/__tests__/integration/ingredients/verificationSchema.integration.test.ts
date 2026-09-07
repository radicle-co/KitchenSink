/**
 * U11 — THE VERIFICATION GATE'S SCHEMA, ASSERTED AGAINST A REAL POSTGRES (migrations 0022 and 0023).
 *
 * ⛔ WHY THIS TIER. Every property below is a property of the DATABASE, and the code that depends on them
 * lives in a DIFFERENT PACKAGE — `recipe-workers` writes both tables over a schema-less handle, while the SQL
 * that creates them ships here. That cross-package seam is exactly where "the migration was filed in the
 * wrong place" hides: the worker's unit suite is green against a mock, and the deploy is green because the
 * migration runner applied whatever it was given. Only a real database, migrated by the real runner, can
 * observe that these tables exist at all.
 *
 * What is asserted, and why each one is load-bearing rather than tidy:
 *
 *  1. **`verification_spend`'s CHECK constraints are the anti-double-refund guard.** `reserved_micros >= 0`
 *     cannot be violated by any correct sequence — every settlement subtracts at most what its own
 *     reservation added — so a violation IS a duplicate settle. The constraint is what converts the one
 *     forbidden operation from a silent under-count into a loud error.
 *  2. **The period key's format check prevents a SECOND row for one month**, which would hand the ceiling
 *     twice its budget. It is a derived, machine-written value, so a malformed one is a code defect that must
 *     be loud rather than absorbed.
 *  3. **`recipe_ingredient_verifications`'s enum checks are the OTHER writer's floor.** recipe-service reads
 *     this table; an unrecognised band is a value with no defined publish behaviour, and the safe-looking
 *     default it would fall back to is the one this gate exists to avoid.
 *  4. **The content key is the primary key**, which is what makes the worker's verdict write idempotent under
 *     redelivery — the worker deliberately swallows a failed verdict write, so it must be safe to re-run.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips in lockstep with
 * `tests/globalSetup.ts`, which applies every `src/database/migrations/*.sql` in filename order.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Periods and keys unique to this suite, so its rows never collide with another spec's. */
const PERIOD = '2099-01';
const KEY_A = 'v1:u11schema00000000000000000000000000000000000000000000000000000a';
const KEY_B = 'v1:u11schema00000000000000000000000000000000000000000000000000000b';
const FOOD = '01JU11SCHEMA000000000FOODA';

describe.skipIf(!hasDatabaseUrl)('U11 verification schema (migrations 0022 + 0023)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM verification_spend WHERE period = $1`, [PERIOD]);
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key = ANY($1)`, [
            [KEY_A, KEY_B],
        ]);
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('verification_spend', () => {
        it('exists, with the four counters defaulting to zero', async () => {
            // The whole point of this tier: the table SHIPS from this package while the code that writes it
            // lives in recipe-workers. If migration 0022 had been filed under recipe-workers — which ships no
            // migration SQL and no runner — nothing would have applied it, and the gate would fail closed on
            // every call while every unit suite stayed green.
            await pool.query(`INSERT INTO verification_spend (period) VALUES ($1)`, [PERIOD]);

            const { rows } = await pool.query<{
                reserved_micros: string;
                settled_micros: string;
                calls: string;
            }>(`SELECT reserved_micros, settled_micros, calls FROM verification_spend WHERE period = $1`, [PERIOD]);

            expect(rows[0]).toEqual({ reserved_micros: '0', settled_micros: '0', calls: '0' });
        });

        it('REFUSES a negative reserved balance — the duplicate-settle guard', async () => {
            await pool.query(`INSERT INTO verification_spend (period, reserved_micros) VALUES ($1, 100)`, [PERIOD]);

            await expect(
                pool.query(`UPDATE verification_spend SET reserved_micros = reserved_micros - 500 WHERE period = $1`, [
                    PERIOD,
                ]),
            ).rejects.toThrow(/verification_spend_reserved_nonnegative/u);
        });

        it.each([['2099-1'], ['99-01'], ['2099-13'], ['2099-00'], ['January'], ['2099-01-15']])(
            'REFUSES the malformed period %s, which would open a second row for one month',
            async (period) => {
                await expect(
                    pool.query(`INSERT INTO verification_spend (period) VALUES ($1)`, [period]),
                ).rejects.toThrow(/verification_spend_period_format/u);
            },
        );

        it('holds a ceiling far beyond an int4, so the configurable ceiling has no hidden limit', async () => {
            // `integer` tops out at ~$2,147 in micro-dollars — a limit nobody would think to look for until an
            // operator raised the ceiling and the counter started erroring mid-incident.
            const beyondInt4 = '9000000000';
            await pool.query(`INSERT INTO verification_spend (period, reserved_micros) VALUES ($1, $2)`, [
                PERIOD,
                beyondInt4,
            ]);

            const { rows } = await pool.query<{ reserved_micros: string }>(
                `SELECT reserved_micros FROM verification_spend WHERE period = $1`,
                [PERIOD],
            );

            expect(rows[0]?.reserved_micros).toBe(beyondInt4);
        });

        it('makes the period the PRIMARY KEY, so one month cannot have two budgets', async () => {
            await pool.query(`INSERT INTO verification_spend (period) VALUES ($1)`, [PERIOD]);

            await expect(pool.query(`INSERT INTO verification_spend (period) VALUES ($1)`, [PERIOD])).rejects.toThrow(
                /duplicate key|verification_spend_pkey/u,
            );
        });
    });

    describe('recipe_ingredient_verifications', () => {
        const insert = (key: string, overrides: Record<string, unknown> = {}): Promise<pg.QueryResult> => {
            const row = {
                verdict: 'agree',
                certainty: 'high',
                band: 'verified',
                aspects: ['identity', 'quantity'],
                model_id: 'amazon.nova-micro-v1:0',
                food_id: FOOD,
                ...overrides,
            };

            return pool.query(
                `INSERT INTO recipe_ingredient_verifications
                     (verification_key, verdict, certainty, band, aspects, model_id, food_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [key, row.verdict, row.certainty, row.band, row.aspects, row.model_id, row.food_id],
            );
        };

        it('stores a verdict with its aspects and its model', async () => {
            await insert(KEY_A);

            const { rows } = await pool.query<{ aspects: string[]; model_id: string }>(
                `SELECT aspects, model_id FROM recipe_ingredient_verifications WHERE verification_key = $1`,
                [KEY_A],
            );

            // R21 — every verification stores the model identifier; the bake-off cannot re-baseline a verdict
            // whose author is unknown.
            expect(rows[0]?.aspects).toEqual(['identity', 'quantity']);
            expect(rows[0]?.model_id).toBe('amazon.nova-micro-v1:0');
        });

        it.each([
            ['verdict', { verdict: 'probably' }, /verdict_check/u],
            ['certainty', { certainty: 'quite sure' }, /certainty_check/u],
            ['band', { band: 'mostly-fine' }, /band_check/u],
        ])('REFUSES an unrecognised %s — the reading service has no default for one', async (_label, override, re) => {
            await expect(insert(KEY_A, override)).rejects.toThrow(re);
        });

        it('REFUSES a verdict that checked no aspects', async () => {
            // A verdict that checked nothing is not a verdict. The pure policy makes it unrepresentable in
            // TypeScript (a non-empty tuple); this is the other writer's floor.
            await expect(insert(KEY_A, { aspects: [] })).rejects.toThrow(/aspects_nonempty/u);
        });

        it('is keyed on the CONTENT, so re-verifying the same judgement upserts', async () => {
            // ⛔ The property that makes the worker's swallowed verdict-write safe: a redelivery must be able
            // to write the same verdict again. Keyed on `recipe_ingredients.id` this would be impossible —
            // `replaceForRecipe` mints fresh ids on every recipe edit.
            await insert(KEY_A);
            await pool.query(
                `INSERT INTO recipe_ingredient_verifications
                     (verification_key, verdict, certainty, band, aspects, model_id, food_id)
                 VALUES ($1, 'disagree', 'high', 'contradicted', ARRAY['quantity'], 'anthropic.claude-haiku-4-5-20251001-v1:0', $2)
                 ON CONFLICT (verification_key) DO UPDATE
                    SET verdict = EXCLUDED.verdict, band = EXCLUDED.band, model_id = EXCLUDED.model_id`,
                [KEY_A, FOOD],
            );

            const { rows } = await pool.query<{ band: string; model_id: string }>(
                `SELECT band, model_id FROM recipe_ingredient_verifications WHERE verification_key = $1`,
                [KEY_A],
            );

            // A re-verification under a NEWER model supersedes the older judgement rather than being dropped.
            expect(rows[0]?.band).toBe('contradicted');
            expect(rows[0]?.model_id).toBe('anthropic.claude-haiku-4-5-20251001-v1:0');
        });

        it('serves the contradicted-lines query from its partial index', async () => {
            // ⛔ The index is the operational read ("what has the gate withheld?"), and it is PARTIAL because
            // `contradicted` is the rare band — a full index would cost a write on every verified line to
            // serve a query about the few that were not. Asserted rather than assumed: without it the query
            // still returns the right answer by sequential scan and the suite stays green while the read
            // degrades silently as the table grows.
            const { rows } = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                  WHERE tablename = 'recipe_ingredient_verifications'
                    AND indexname = 'idx_line_verifications_contradicted'`,
            );

            expect(rows[0]?.indexdef).toMatch(/WHERE \(band = 'contradicted'/u);
        });

        it('indexes by model and time, which is what makes a bake-off re-baseline repeatable', async () => {
            const { rows } = await pool.query(
                `SELECT 1 FROM pg_indexes
                  WHERE tablename = 'recipe_ingredient_verifications'
                    AND indexname = 'idx_line_verifications_model'`,
            );

            expect(rows).toHaveLength(1);
        });

        it('stores NO model-authored free text', async () => {
            // ⛔ A `reason` column would hold text a model wrote ABOUT a cook's recipe line — user-derived
            // personal data in a table with no owner, reachable by no erasure sweep. Its absence is a
            // decision, so it is asserted: adding one must be a deliberate act that reds this test, not a
            // convenience that slips in with a debugging session.
            const { rows } = await pool.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_name = 'recipe_ingredient_verifications'`,
            );
            const columns = rows.map((row) => row.column_name);

            expect(columns).not.toContain('reason');
            expect(columns).not.toContain('source_line');
            expect(columns).not.toContain('owner_id');
        });
    });
});
