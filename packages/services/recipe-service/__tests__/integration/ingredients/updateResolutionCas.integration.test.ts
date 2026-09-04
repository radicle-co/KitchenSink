/**
 * `IngredientsDal.updateResolution` is a compare-and-set on the status the caller OBSERVED (PR #91 review) —
 * proved against a real Postgres, because the guarantee is a `WHERE` predicate and a mocked `execute` cannot
 * see one.
 *
 * ⛔ WHY. The write used to be unconditional (`WHERE id = $1`). Two refreshes of one PENDING row both read
 * PENDING; the food service answered the second first (RESOLVED, with the catalog name), then the delayed
 * answer to the first arrived (still PENDING) — and the stale write regressed the row, name and all. Nothing
 * downstream could tell; the picker just went on polling a row the food service had already resolved.
 *
 * The predicate is `food_resolution_status IS NOT DISTINCT FROM :expected`, and three things about it are
 * pinned here rather than assumed:
 *
 *  1. A mismatch writes NOTHING — not the status, and not the four other columns the same statement sets
 *     (`name`, `search_vector`, `prior_fraction`, `food_owner_id`). A predicate that guarded the status alone
 *     while the rest of the `SET` list still landed would pass a status-only assertion.
 *  2. `expectedStatus: null` matches ONLY a NULL current status. A `=` implementation never matches NULL, so
 *     an unlinked row (U12's reset leaves `food_resolution_status` NULL) could never be re-linked.
 *  3. The terminal → PENDING reactivation is a legitimate observed transition and still lands.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** A food id unique to this suite so its rows never collide with other integration specs. */
const FOOD_ID = '01JINGCASRACE0000000000FD1';
const OWNER = '01JINGCASRACE00000000OWNER';

interface RawRow {
    readonly name: string;
    readonly food_resolution_status: string | null;
    readonly prior_fraction: string | null;
    readonly food_owner_id: string | null;
    readonly search_vector: string;
}

describe.skipIf(!hasDatabaseUrl)('IngredientsDal.updateResolution — compare-and-set on the observed status', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = $1', [FOOD_ID]);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = $1', [FOOD_ID]);
    });

    /** The row exactly as stored — read straight from the database, not through the code under test. */
    async function rawRow(id: string): Promise<RawRow> {
        const { rows } = await pool.query<RawRow>(
            `SELECT name, food_resolution_status, prior_fraction::text, food_owner_id, search_vector::text
               FROM ingredients WHERE id = $1`,
            [id],
        );

        if (rows[0] === undefined) {
            throw new Error(`test setup: no row ${id}`);
        }

        return rows[0];
    }

    it('writes when the observed status is the current one', async () => {
        const row = await dal.createFoodBacked({
            name: makeCanonicalName('Cas quinoa'),
            foodId: FOOD_ID,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });

        const updated = await dal.updateResolution(row.id, {
            expectedStatus: FoodResolutionStatus.PENDING,
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            canonicalName: makeCanonicalName('Quinoa, cooked'),
            priorFraction: 0.25,
            foodOwnerId: OWNER,
        });

        expect(updated?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
        expect(await rawRow(row.id)).toMatchObject({
            name: 'Quinoa, cooked',
            food_resolution_status: 'RESOLVED',
            prior_fraction: '0.25',
            food_owner_id: OWNER,
        });
    });

    it('writes NOTHING — not one of the five columns — when the status moved since it was observed', async () => {
        const row = await dal.createFoodBacked({
            name: makeCanonicalName('Cas quinoa'),
            foodId: FOOD_ID,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        // Somebody else's refresh landed first.
        await dal.updateResolution(row.id, {
            expectedStatus: FoodResolutionStatus.PENDING,
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            canonicalName: makeCanonicalName('Quinoa, cooked'),
            priorFraction: 0.25,
            foodOwnerId: OWNER,
        });
        const before = await rawRow(row.id);

        // The stale writer, still believing the row is PENDING, tries to set every column.
        const stale = await dal.updateResolution(row.id, {
            expectedStatus: FoodResolutionStatus.PENDING,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
            canonicalName: makeCanonicalName('Stale name'),
            priorFraction: 0.9,
            foodOwnerId: null,
        });

        expect(stale).toBeUndefined();
        expect(await rawRow(row.id)).toEqual(before);
    });

    it('treats a NULL expectation as "the row is unlinked" — it matches only a NULL current status', async () => {
        const row = await dal.createFoodBacked({
            name: makeCanonicalName('Cas quinoa'),
            foodId: FOOD_ID,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });

        // A NULL expectation against a PENDING row matches nothing.
        expect(
            await dal.updateResolution(row.id, {
                expectedStatus: null,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        ).toBeUndefined();

        // The reset (U12) nulls the status; a NULL expectation now matches, and the row re-links.
        await pool.query('UPDATE ingredients SET food_resolution_status = NULL WHERE id = $1', [row.id]);
        const relinked = await dal.updateResolution(row.id, {
            expectedStatus: null,
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });

        expect(relinked?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
    });

    it('still lands the terminal → PENDING reactivation a refresh genuinely observed', async () => {
        const row = await dal.createFoodBacked({
            name: makeCanonicalName('Cas quinoa'),
            foodId: FOOD_ID,
            foodResolutionStatus: FoodResolutionStatus.FAILED,
        });

        const reactivated = await dal.updateResolution(row.id, {
            expectedStatus: FoodResolutionStatus.FAILED,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });

        expect(reactivated?.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
    });

    it('returns undefined for a row that does not exist, exactly as before', async () => {
        expect(
            await dal.updateResolution('00000000-0000-4000-8000-000000000000', {
                expectedStatus: FoodResolutionStatus.PENDING,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        ).toBeUndefined();
    });
});
