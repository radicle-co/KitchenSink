/**
 * U20 — a `food_lookups` row names EXACTLY ONE of three things, asserted against a real migrated PostgreSQL.
 *
 * The owner-ruled model (plan 002 R7, 2026-09-22; curated catalog plan U20): an ingredient's binding points at
 * a root food (`food_id`), a variant of a root (`food_variant_id`), or the record of a failed lookup
 * (`unresolved_food_id`) — one of the three, never none, never two. Migration `0051_ingredient_grain.sql` makes
 * that a fact of the database with `num_nonnulls(...) = 1`, and this suite reads it back from the server.
 *
 * ## ⛔ Why the arms are checked as a full matrix
 *
 * The two-arm form of this rule was `(a IS NULL) <> (b IS NULL)`. Stacking that to three arms accepts rows with
 * all three set and refuses valid single-arm rows, so a partial matrix (zero arms, all arms) passes against the
 * broken form. Every pair of arms is therefore refused on its own, and every single arm is admitted on its own.
 *
 * ## ⛔ Every refusal has a positive control
 *
 * A refusal passes against a table that refuses every row, or that does not exist. Each describe block admits
 * the legal shape beside the illegal ones it refuses.
 *
 * Every row this file writes is scoped by {@link SCOPE} and removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { hasTestDatabase, recipeE2eDb } from '../support/roleDb.js';

const roleDb = recipeE2eDb();

/** The prefix every row this file writes carries, so cleanup is a predicate and never a list of ids. */
const SCOPE = 'e2e-arms';

/** The author ULID a private-food binding captures. */
const SCOPE_OWNER = '01JARMS000000000000OWNER00';

/** SQLSTATE `check_violation`. */
const CHECK_VIOLATION = '23514';

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

let pool: pg.Pool;

/**
 * Run a statement that is expected to be REFUSED and report the server's verdict.
 *
 * ⛔ Returns a sentinel when the statement SUCCEEDS, so the assertion fails on the real outcome rather than on a
 * thrown error that does not say which direction broke.
 *
 * @param text - The statement.
 * @param values - Its bound parameters.
 * @returns The SQLSTATE the server raised, or a sentinel.
 * @sideEffect Executes SQL against the e2e database.
 */
async function sqlStateOf(text: string, values: readonly unknown[] = []): Promise<string> {
    try {
        await pool.query(text, [...values]);
    } catch (error) {
        return (error as { code?: string }).code ?? '(threw with no SQLSTATE)';
    }

    return '(statement succeeded)';
}

/**
 * Insert an `unresolved_foods` row and return its id.
 *
 * @param label - Distinguishes this row from the others a case creates.
 * @returns The new row's id.
 * @sideEffect Inserts a row.
 */
async function makeUnresolved(label: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO unresolved_foods (name, normalized_key, reason_code)
              VALUES ($1, $2, 'cascade_exhausted')
           RETURNING id`,
        [`${SCOPE} ${label}`, `${SCOPE}:${label}`],
    );
    // Index-bound: `noUncheckedIndexedAccess` is OFF, so the compiler types this as present when an empty
    // `RETURNING` makes it `undefined`.
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`unresolved_foods insert for "${label}" returned no row`);
    }

    return row.id;
}

/**
 * Insert a lookup and return how many rows the server wrote.
 *
 * @param columns - The arm columns to set, by name.
 * @returns The inserted row count.
 * @sideEffect Inserts a row.
 */
async function insertLookup(columns: Readonly<Record<string, string>>): Promise<number> {
    const names = Object.keys(columns);
    const placeholders = names.map((_, index) => `$${String(index + 1)}`);
    const result = await pool.query(
        `INSERT INTO food_lookups (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
        Object.values(columns),
    );

    return result.rowCount ?? 0;
}

describe.skipIf(!hasTestDatabase)('the food_lookups arms (0051, U20)', () => {
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
    });

    afterAll(async () => {
        if (pool === undefined) {
            return;
        }

        await pool.query(
            `DELETE FROM food_lookups
                   WHERE food_id LIKE $1
                      OR food_variant_id LIKE $1
                      OR unresolved_food_id IN (SELECT id FROM unresolved_foods WHERE name LIKE $1)`,
            [`${SCOPE}%`],
        );
        await pool.query('DELETE FROM unresolved_foods WHERE name LIKE $1', [`${SCOPE}%`]);
        await pool.end();
    });

    describe('⛔ a lookup names EXACTLY ONE arm', () => {
        it('refuses a lookup with no arm', async () => {
            expect(
                await sqlStateOf(
                    `INSERT INTO food_lookups (food_id, food_variant_id, unresolved_food_id) VALUES (NULL, NULL, NULL)`,
                ),
            ).toBe(CHECK_VIOLATION);
        });

        it('refuses every PAIR of arms, each on its own', async () => {
            const withRoot = await makeUnresolved('pair-root-unresolved');
            const withVariant = await makeUnresolved('pair-variant-unresolved');

            expect(
                await sqlStateOf(`INSERT INTO food_lookups (food_id, food_variant_id) VALUES ($1, $2)`, [
                    `${SCOPE}-pair-root`,
                    `${SCOPE}-pair-variant`,
                ]),
            ).toBe(CHECK_VIOLATION);
            expect(
                await sqlStateOf(`INSERT INTO food_lookups (food_id, unresolved_food_id) VALUES ($1, $2)`, [
                    `${SCOPE}-pair-root-2`,
                    withRoot,
                ]),
            ).toBe(CHECK_VIOLATION);
            expect(
                await sqlStateOf(`INSERT INTO food_lookups (food_variant_id, unresolved_food_id) VALUES ($1, $2)`, [
                    `${SCOPE}-pair-variant-2`,
                    withVariant,
                ]),
            ).toBe(CHECK_VIOLATION);
        });

        it('refuses all three arms at once', async () => {
            const unresolvedId = await makeUnresolved('all-three');

            expect(
                await sqlStateOf(
                    `INSERT INTO food_lookups (food_id, food_variant_id, unresolved_food_id) VALUES ($1, $2, $3)`,
                    [`${SCOPE}-all-root`, `${SCOPE}-all-variant`, unresolvedId],
                ),
            ).toBe(CHECK_VIOLATION);
        });

        it('admits EACH arm alone — the positive control for every refusal above', async () => {
            expect(await insertLookup({ food_id: `${SCOPE}-single-root` })).toBe(1);
            expect(await insertLookup({ food_variant_id: `${SCOPE}-single-variant` })).toBe(1);
            expect(await insertLookup({ unresolved_food_id: await makeUnresolved('single-unresolved') })).toBe(1);
        });
    });

    describe('⛔ one lookup per root, per variant and per failure record', () => {
        it('refuses a second lookup for the same root, the same variant or the same failure record', async () => {
            const unresolvedId = await makeUnresolved('dup-unresolved');

            expect(await insertLookup({ food_id: `${SCOPE}-dup-root` })).toBe(1);
            expect(await insertLookup({ food_variant_id: `${SCOPE}-dup-variant` })).toBe(1);
            expect(await insertLookup({ unresolved_food_id: unresolvedId })).toBe(1);

            expect(await sqlStateOf(`INSERT INTO food_lookups (food_id) VALUES ($1)`, [`${SCOPE}-dup-root`])).toBe(
                UNIQUE_VIOLATION,
            );
            expect(
                await sqlStateOf(`INSERT INTO food_lookups (food_variant_id) VALUES ($1)`, [`${SCOPE}-dup-variant`]),
            ).toBe(UNIQUE_VIOLATION);
            expect(await sqlStateOf(`INSERT INTO food_lookups (unresolved_food_id) VALUES ($1)`, [unresolvedId])).toBe(
                UNIQUE_VIOLATION,
            );
        });

        it('admits a root and a variant that share an id string — the arms dedup separately', async () => {
            // The control for the per-arm indexes: one index over all arms would refuse this pair.
            expect(await insertLookup({ food_id: `${SCOPE}-shared-id` })).toBe(1);
            expect(await insertLookup({ food_variant_id: `${SCOPE}-shared-id` })).toBe(1);
        });
    });

    describe('⛔ `food_owner_id` belongs to the root arm only', () => {
        it('refuses an owner on the variant arm and on the unresolved arm, and admits one on the root arm', async () => {
            // A private authored food is always a root: the seed alone writes variants, and it writes no
            // private ones. The account-erasure sweep keys on this column, so an owner on another arm is a
            // binding erasure would act on for no reason.
            expect(
                await sqlStateOf(`INSERT INTO food_lookups (food_variant_id, food_owner_id) VALUES ($1, $2)`, [
                    `${SCOPE}-owner-variant`,
                    SCOPE_OWNER,
                ]),
            ).toBe(CHECK_VIOLATION);
            expect(
                await sqlStateOf(`INSERT INTO food_lookups (unresolved_food_id, food_owner_id) VALUES ($1, $2)`, [
                    await makeUnresolved('owner-unresolved'),
                    SCOPE_OWNER,
                ]),
            ).toBe(CHECK_VIOLATION);

            expect(await insertLookup({ food_id: `${SCOPE}-owner-root`, food_owner_id: SCOPE_OWNER })).toBe(1);
        });
    });
});
