/**
 * T028/T029/T067 — ingredient async-resolution ADD-BY-NAME integration (data-model R5).
 *
 * The entry point of the async-resolution vertical, proven over the REAL {@link IngredientsDal} against
 * Docker Postgres (migrated + seeded by `tests/global-setup.ts`) with the external food service (003)
 * stubbed at the `FoodServiceClient` boundary — the one dependency 001 does not own. This proves what a
 * mocked `db.execute` cannot: `addByName` actually WRITES a food-backed catalog row (its non-terminal
 * `food_resolution_status`, its opaque `food_id`, and `is_user_entered = false`) through the real
 * `createFoodBacked` SQL (`search_vector`, `findByFoodId` dedup, numeric/`null` mapping), so the picker has
 * a persisted row to poll/disambiguate.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up simply skips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { makeAddResult } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Food ids unique to this suite so its rows never collide with other integration specs. */
const PENDING_FOOD_ID = '01JINGADDBYNAME00000PENDING';
const UNRESOLVED_FOOD_ID = '01JINGADDBYNAME000UNRESOLV0';

/** A minimally-stubbed food client: only the `addByName` this vertical's entry point calls. */
function makeFoodClientStub(): FoodServiceClient {
    return { addByName: vi.fn() } as unknown as FoodServiceClient;
}

describe.skipIf(!hasDatabaseUrl)('ingredient addByName (integration: service + real DAL + stubbed food client)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;
    let food: FoodServiceClient;
    let service: IngredientsService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1)', [[PENDING_FOOD_ID, UNRESOLVED_FOOD_ID]]);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1)', [[PENDING_FOOD_ID, UNRESOLVED_FOOD_ID]]);
        food = makeFoodClientStub();
        service = new IngredientsService(dal, food);
    });

    /** Re-read the persisted row's status + food link straight from the DB (not the service's return value). */
    async function readRow(foodId: string): Promise<{ status: string; is_user_entered: boolean } | undefined> {
        const { rows } = await pool.query<{ food_resolution_status: string; is_user_entered: boolean }>(
            'SELECT food_resolution_status, is_user_entered FROM ingredients WHERE food_id = $1',
            [foodId],
        );
        const row = rows[0];

        return row === undefined
            ? undefined
            : { status: row.food_resolution_status, is_user_entered: row.is_user_entered };
    }

    it('adds a PENDING food and PERSISTS a food-backed catalog row (poll-able by the picker)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: PENDING_FOOD_ID, status: FoodResolutionStatus.PENDING }),
        );

        const ingredient = await service.addByName('  Quinoa integration  ');

        // The food client saw the TRIMMED name; the returned row is the non-terminal, food-linked catalog row.
        expect(food.addByName).toHaveBeenCalledWith('Quinoa integration');
        expect(ingredient.foodId).toBe(PENDING_FOOD_ID);
        expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
        expect(ingredient.isUserEntered).toBe(false);

        // Re-read from the DB: the row was actually written through (not just returned in-memory).
        expect(await readRow(PENDING_FOOD_ID)).toEqual({ status: 'PENDING', is_user_entered: false });
    });

    it('adds an UNRESOLVED food and persists its UNRESOLVED status (drives disambiguation)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: UNRESOLVED_FOOD_ID, status: FoodResolutionStatus.UNRESOLVED }),
        );

        const ingredient = await service.addByName('Ambiguous integration');

        expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        expect(await readRow(UNRESOLVED_FOOD_ID)).toEqual({ status: 'UNRESOLVED', is_user_entered: false });
    });

    it('dedups on food_id: a second addByName for the same food returns the existing row (one DB row)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: PENDING_FOOD_ID, status: FoodResolutionStatus.PENDING }),
        );

        const first = await service.addByName('Quinoa integration');
        const second = await service.addByName('Quinoa integration again');

        expect(second.id).toBe(first.id);
        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*)::int AS n FROM ingredients WHERE food_id = $1',
            [PENDING_FOOD_ID],
        );
        expect(Number(rows[0]!.n)).toBe(1);
    });
});
