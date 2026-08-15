/**
 * T028/T029/T067 — ingredient async-resolution DISAMBIGUATION integration (data-model R5).
 *
 * Exercises {@link IngredientsService} over the REAL {@link IngredientsDal} against Docker Postgres
 * (migrated + seeded by `tests/globalSetup.ts`) with the external food service (003) stubbed at the
 * `FoodServiceClient` boundary — the ONLY external dependency, and the one 001 does not own. This proves
 * the behaviours a mocked `db.execute` cannot: the poll's write-through actually persists the golden-record
 * per-100g nutrition + household portions into the `ingredients` row, a terminal food is recorded (never
 * thrown), and `resolve` drives an `UNRESOLVED` row to `RESOLVED` with nutrition through the real SQL
 * (`updateResolution`'s `COALESCE` + `jsonb` cast, `createFoodBacked`'s `search_vector`, `findById`'s
 * numeric/`null` mapping).
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up simply skips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { FoodServiceClient, NotFoundError } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeCandidateView,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** A food id unique to this suite so its rows never collide with other integration specs. */
const FOOD_ID = '01JINGDISAMBIG0000000000FD';

/** A minimally-stubbed food client: only the async-resolution methods this vertical calls. */
function makeFoodClientStub(): FoodServiceClient {
    return {
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        resolve: vi.fn(),
    } as unknown as FoodServiceClient;
}

/** A no-op catalog gateway — the disambiguation path never blends (see `blendedSuggest.integration.test.ts`). */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
}

describe.skipIf(!hasDatabaseUrl)(
    'ingredient disambiguation (integration: service + real DAL + stubbed food client)',
    () => {
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
            await pool.query('DELETE FROM ingredients WHERE food_id = $1', [FOOD_ID]);
            await pool.end();
        });

        beforeEach(async () => {
            await pool.query('DELETE FROM ingredients WHERE food_id = $1', [FOOD_ID]);
            food = makeFoodClientStub();
            service = new IngredientsService(dal, foodClientsOf(food), makeCatalogStub());
        });

        /** Seed a food-backed catalog row in the given non-terminal status and return its 001 id. */
        async function seedFoodBacked(status: FoodResolutionStatus): Promise<string> {
            const row = await dal.createFoodBacked({
                name: 'Ambiguous quinoa',
                foodId: FOOD_ID,
                foodResolutionStatus: status,
            });

            return row.id;
        }

        it('getCandidates proxies the food client for an UNRESOLVED food-backed ingredient', async () => {
            const id = await seedFoodBacked(FoodResolutionStatus.UNRESOLVED);
            const candidate = makeCandidateView({ candidateId: 'cand-a', name: 'Quinoa, cooked' });
            vi.mocked(food.getCandidates).mockResolvedValue({ id: FOOD_ID, candidates: [candidate] });

            const result = await service.getCandidates(CALLER, id);

            expect(food.getCandidates).toHaveBeenCalledWith(FOOD_ID);
            expect(result).toEqual([candidate]);
        });

        it('resolve drives UNRESOLVED → RESOLVED and PERSISTS the golden-record nutrition + portions to the row', async () => {
            const id = await seedFoodBacked(FoodResolutionStatus.UNRESOLVED);
            vi.mocked(food.resolve).mockResolvedValue({ id: FOOD_ID, status: FoodResolutionStatus.RESOLVED });
            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({
                        id: FOOD_ID,
                        portions: [{ label: '1 cup', gramWeight: 185, source: 'usda' }],
                    }),
                }),
            );

            const resolved = await service.resolve(CALLER, id, ['cand-a']);

            // The exact pick reaches the food client (mutation guard: a wrong id would fail here).
            expect(food.resolve).toHaveBeenCalledWith(FOOD_ID, ['cand-a']);
            expect(resolved.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);

            // Re-read from the DB: the golden nutrition + a parsed portion were actually written through.
            const reread = await dal.findById(id);
            expect(reread?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect(reread?.caloriesPer100g).toBe(364);
            expect(reread?.proteinGPer100g).toBe(10.3);
            expect(reread?.portions).toEqual([{ unit: 'cup', gramsPerUnit: 185 }]);
        });

        it('resolve is converge-only: a second resolve does NOT re-point an already-RESOLVED row', async () => {
            // Drive UNRESOLVED → RESOLVED once, capturing the settled food link + nutrition.
            const id = await seedFoodBacked(FoodResolutionStatus.UNRESOLVED);
            vi.mocked(food.resolve).mockResolvedValue({ id: FOOD_ID, status: FoodResolutionStatus.RESOLVED });
            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FOOD_ID }),
                }),
            );

            await service.resolve(CALLER, id, ['cand-a']);
            const afterFirst = await dal.findById(id);
            expect(afterFirst?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect(afterFirst?.caloriesPer100g).toBe(364);

            // A SECOND resolve with a DIFFERENT pick must be an idempotent no-op — the ownerless shared row
            // must not be re-pointed. If the converge-only guard were removed, food.resolve would fire with
            // 'cand-b' and the persisted row could change; both assertions below would fail.
            vi.mocked(food.resolve).mockClear();
            vi.mocked(food.getStatus).mockClear();

            const returned = await service.resolve(CALLER, id, ['cand-b']);

            expect(food.resolve).not.toHaveBeenCalled();
            expect(food.getStatus).not.toHaveBeenCalled();
            const afterSecond = await dal.findById(id);
            expect(afterSecond).toEqual(afterFirst); // the persisted row is byte-for-byte unchanged
            expect(returned.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
        });

        it('poll (refreshStatus) persists nutrition once a PENDING food RESOLVES', async () => {
            const id = await seedFoodBacked(FoodResolutionStatus.PENDING);
            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FOOD_ID }),
                }),
            );

            const refreshed = await service.refreshStatus(CALLER, id);

            expect(refreshed.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect((await dal.findById(id))?.caloriesPer100g).toBe(364);
        });

        it('poll records a terminal NOT_FOUND food as the row status (never throws)', async () => {
            const id = await seedFoodBacked(FoodResolutionStatus.PENDING);
            vi.mocked(food.getStatus).mockRejectedValue(new NotFoundError(FOOD_ID, FoodResolutionStatus.NOT_FOUND));

            const refreshed = await service.refreshStatus(CALLER, id);

            expect(refreshed.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
            expect((await dal.findById(id))?.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
        });
    },
);
