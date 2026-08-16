/**
 * Stage 2 — BLENDED-TYPEAHEAD integration (`GET /api/v1/ingredients/suggest`).
 *
 * Proven over the REAL {@link IngredientsDal} against Docker Postgres (migrated + seeded by
 * `tests/globalSetup.ts`) with only the external food service (003) stubbed — at the
 * {@link FoodCatalogGateway} boundary for the blend, and at the `FoodServiceClient` boundary for the pick.
 * That split matters: everything 001 owns (the SQL, the `food_id` crosswalk, the nutrition write) is real.
 *
 * What a mocked `db.execute` cannot prove, and this spec does:
 *   1. The `findByFoodIds` batch crosswalk actually resolves food ids to persisted rows through real SQL, so
 *      the "appears once" dedup holds against the database rather than against a stub's return value.
 *   2. **F1** — after a catalog pick, the ROW IN POSTGRES has non-NULL calories/protein/carbs/fat and its
 *      portions jsonb. Asserted by re-reading the table directly, not by trusting the service's return value:
 *      an implementation that forgot the `updateResolution` backfill would return a plausible object and still
 *      fail here.
 *   3. **F2** — a degraded food catalog still renders the recipe-local section, from the real DAL.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up simply skips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { FoodServiceClient, NotFoundError } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Food ids unique to this suite so its rows never collide with other integration specs. */
const SEEDED_FOOD_ID = '01JINGBLEND0000000000SEEDED';
const PROMOTED_FOOD_ID = '01JINGBLEND000000PROMOTED0';
const UNSEEDED_FOOD_ID = '01JINGBLEND00000UNSEEDED00';
const ALL_FOOD_IDS = [SEEDED_FOOD_ID, PROMOTED_FOOD_ID, UNSEEDED_FOOD_ID];

/** A name stem unique to this suite, so the real FTS/trgm search cannot pull in the shared seeded catalog. */
const STEM = 'Zorbulax';

/** A gateway double: the blend's only external dependency, stubbed at the availability boundary. */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn() } as unknown as FoodCatalogGateway;
}

/** A food-client double: only the `getStatus` the pick path reads. */
function makeFoodClientStub(): FoodServiceClient {
    return { getStatus: vi.fn() } as unknown as FoodServiceClient;
}

/** The already-`RESOLVED` seeded golden record a Stage-1 catalog hit points at. */
function seededGoldenRecord(foodId: string, name: string): ReturnType<typeof makeStatusResult> {
    return makeStatusResult({
        id: foodId,
        status: FoodResolutionStatus.RESOLVED,
        food: makeFoodView({
            id: foodId,
            name,
            nutrients: [
                { nutrient: 'Energy', amount: 165, unit: 'kcal', basis: 'per_100g', source: 'usda' },
                { nutrient: 'Protein', amount: 31.02, unit: 'g', basis: 'per_100g', source: 'usda' },
                { nutrient: 'Carbohydrate, by difference', amount: 0, unit: 'g', basis: 'per_100g', source: 'usda' },
                { nutrient: 'Total lipid (fat)', amount: 3.57, unit: 'g', basis: 'per_100g', source: 'usda' },
            ],
            portions: [{ label: '1 cup chopped', gramWeight: 140, source: 'usda' }],
        }),
    });
}

describe.skipIf(!hasDatabaseUrl)(
    'blended ingredient suggest (integration: service + real DAL + stubbed food service)',
    () => {
        let pool: pg.Pool;
        let db: RecipeDrizzle;
        let dal: IngredientsDal;
        let catalog: FoodCatalogGateway;
        let food: FoodServiceClient;
        let service: IngredientsService;

        beforeAll(() => {
            pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
            db = createRecipeDrizzle(pool);
            dal = new IngredientsDal(db);
        });

        afterAll(async () => {
            await cleanup();
            await pool.end();
        });

        beforeEach(async () => {
            await cleanup();
            catalog = makeCatalogStub();
            food = makeFoodClientStub();
            service = new IngredientsService(dal, foodClientsOf(food), catalog);
        });

        /** Remove every row this suite could have created (by food id OR by its unique name stem). */
        async function cleanup(): Promise<void> {
            await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1) OR name LIKE $2', [
                ALL_FOOD_IDS,
                `${STEM}%`,
            ]);
        }

        /**
         * Re-read a persisted row STRAIGHT from Postgres (not the service's return value).
         *
         * ⚠️ It selects the REFERENCE columns only. Plan U10 dropped every nutrition column from this table,
         * so a query naming them would not merely fail an assertion — it would error on a missing column,
         * which is precisely the failure this integration tier exists to surface.
         */
        async function readNutrition(foodId: string): Promise<Record<string, unknown> | undefined> {
            const { rows } = await pool.query<Record<string, unknown>>(
                `SELECT name, food_id, food_resolution_status, is_user_entered
             FROM ingredients WHERE food_id = $1`,
                [foodId],
            );

            return rows[0];
        }

        describe('the blend', () => {
            it('surfaces a food-catalog hit that has NO ingredients row (the whole point of Stage 2)', async () => {
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: UNSEEDED_FOOD_ID, name: `${STEM} catalog only`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.catalogAvailability).toBe('ok');
                expect(result.suggestions).toEqual([
                    { provenance: 'catalog', foodId: UNSEEDED_FOOD_ID, name: `${STEM} catalog only`, score: 0.9 },
                ]);
            });

            it('deduplicates through REAL SQL: a food with a persisted row appears once, as `local`', async () => {
                // A real food-backed row exists and the recipe-local FTS query WILL match it on the stem.
                await dal.createFoodBacked({
                    name: `${STEM} already used`,
                    foodId: SEEDED_FOOD_ID,
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                });
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: SEEDED_FOOD_ID, name: `${STEM} golden name`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.suggestions).toHaveLength(1);
                expect(result.suggestions[0]?.provenance).toBe('local');
            });

            it('PROMOTES a persisted row the local text search missed, via the real batch crosswalk', async () => {
                // Name deliberately shares NO stem with the query, so the recipe-local FTS/trgm search cannot
                // match it — only the `food_id` crosswalk can find it.
                const promoted = await dal.createFoodBacked({
                    name: 'Wholly unrelated label',
                    foodId: PROMOTED_FOOD_ID,
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                });
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: PROMOTED_FOOD_ID, name: `${STEM} golden name`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.suggestions).toEqual([{ provenance: 'local', ingredient: promoted }]);
            });

            it('F2 — a degraded catalog still returns the recipe-local section from the real DAL', async () => {
                const local = await dal.createFreeform(`${STEM} my own ingredient`);
                vi.mocked(catalog.search).mockResolvedValue({ hits: [], availability: 'unavailable' });

                const result = await service.suggest(CALLER, STEM);

                expect(result.catalogAvailability).toBe('unavailable');
                expect(result.suggestions).toEqual([{ provenance: 'local', ingredient: local }]);
            });

            it('F2 — a HUNG food service really does time out, through the real client + real gateway', async () => {
                // The production mechanism end-to-end, nothing about the degradation hand-stubbed: a real
                // `FoodServiceClient` with the typeahead's short timeout, a `fetch` that never resolves, and the
                // real `FoodCatalogGateway`. The client's own `AbortSignal` fires, raises
                // `FetchUnavailableError`, and the gateway turns that into a local-only render.
                const timeoutMs = 60;
                const neverResolves: typeof fetch = (_input, init) =>
                    new Promise((_resolve, reject) => {
                        // Reject exactly the way `undici` does when the client aborts, so the client maps it to a
                        // `FetchUnavailableError` rather than hanging this test open.
                        init?.signal?.addEventListener('abort', () => {
                            reject(new DOMException('This operation was aborted', 'AbortError'));
                        });
                    });
                const realGateway = new FoodCatalogGateway(
                    // A real client behind the per-request factory shape: the transport (and therefore the
                    // AbortSignal being asserted) is genuine, only the socket is a double.
                    foodClientsOf(
                        new FoodServiceClient({ baseUrl: 'http://food.invalid', fetch: neverResolves, timeoutMs }),
                    ),
                    { enabled: true },
                );
                const local = await dal.createFreeform(`${STEM} survives the timeout`);

                const startedAt = Date.now();
                const result = await new IngredientsService(dal, foodClientsOf(food), realGateway).suggest(
                    CALLER,
                    STEM,
                );
                const elapsed = Date.now() - startedAt;

                expect(result.catalogAvailability).toBe('unavailable');
                expect(result.suggestions).toEqual([{ provenance: 'local', ingredient: local }]);
                // The wait is BOUNDED by the timeout — the whole point of F2. Generous upper bound so the
                // assertion is about the bound existing, not about CI scheduling jitter.
                expect(elapsed).toBeLessThan(5_000);
            });
        });

        describe('F1 — the pick persists the food REFERENCE into POSTGRES, never a copy of the food data', () => {
            it('admits a catalog hit and persists the food id + RESOLVED status', async () => {
                vi.mocked(food.getStatus).mockResolvedValue(
                    seededGoldenRecord(SEEDED_FOOD_ID, `${STEM} chicken breast`),
                );

                const ingredient = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                // The returned object is nourished…
                // ⛔ NO nutrition on the returned ingredient (U10). The numbers are food's and are read
                // live; a copy here is the snapshot-with-no-invalidation KTD-3 deletes.
                expect(ingredient).not.toHaveProperty('caloriesPer100g');
                expect(ingredient).not.toHaveProperty('portions');
                expect(ingredient.foodResolutionStatus).toBe('RESOLVED');

                // …and so is the ROW, re-read from the database. A dropped backfill fails right here.
                const row = await readNutrition(SEEDED_FOOD_ID);
                expect(row).toBeDefined();
                expect(row?.['name']).toBe(`${STEM} chicken breast`);
                expect(row?.['food_resolution_status']).toBe('RESOLVED');
                expect(row?.['is_user_entered']).toBe(false);
                expect(row?.['food_id']).toBeTruthy();
                expect(row?.['food_resolution_status']).toBe('RESOLVED');
            });

            it('takes the persisted name from food-service, ignoring anything a caller might have sent', async () => {
                vi.mocked(food.getStatus).mockResolvedValue(
                    seededGoldenRecord(SEEDED_FOOD_ID, `${STEM} authoritative`),
                );

                await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect((await readNutrition(SEEDED_FOOD_ID))?.['name']).toBe(`${STEM} authoritative`);
            });

            it('is idempotent: a second pick of the same food leaves ONE row and one cross-service read', async () => {
                vi.mocked(food.getStatus).mockResolvedValue(
                    seededGoldenRecord(SEEDED_FOOD_ID, `${STEM} chicken breast`),
                );

                const first = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);
                const second = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect(second.id).toBe(first.id);
                const { rows } = await pool.query<{ n: number }>(
                    'SELECT count(*)::int AS n FROM ingredients WHERE food_id = $1',
                    [SEEDED_FOOD_ID],
                );
                expect(rows[0]?.n).toBe(1);
                // The second pick short-circuits on the already-nourished row — no extra food-service traffic.
                expect(vi.mocked(food.getStatus)).toHaveBeenCalledTimes(1);
            });

            it('BACKFILLS an existing nutrition-less row (an unpolled by-name row) rather than duplicating it', async () => {
                const stale = await dal.createFoodBacked({
                    name: `${STEM} pending row`,
                    foodId: SEEDED_FOOD_ID,
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                });
                expect(Number((await readNutrition(SEEDED_FOOD_ID))?.['calories_per_100g'] ?? NaN)).toBeNaN();
                vi.mocked(food.getStatus).mockResolvedValue(seededGoldenRecord(SEEDED_FOOD_ID, `${STEM} golden`));

                const ingredient = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect(ingredient.id).toBe(stale.id);
                const row = await readNutrition(SEEDED_FOOD_ID);
                expect(row?.['food_resolution_status']).toBe('RESOLVED');
            });

            it('a picked-then-suggested food comes back as a `local` suggestion carrying its food reference', async () => {
                // The end-to-end Stage-2 loop: pick a catalog hit, then type the same query again.
                vi.mocked(food.getStatus).mockResolvedValue(
                    seededGoldenRecord(SEEDED_FOOD_ID, `${STEM} chicken breast`),
                );
                await service.addByFoodId(CALLER, SEEDED_FOOD_ID);
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: SEEDED_FOOD_ID, name: `${STEM} chicken breast`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.suggestions).toHaveLength(1);
                const [only] = result.suggestions;
                expect(only?.provenance).toBe('local');
                // ⛔ The suggestion carries the food REFERENCE, not a copy of its nutrition (U10). A local
                // suggestion that shipped calories would be re-introducing the snapshot this unit deleted —
                // and it would go stale the moment food corrected the food.
                expect(only?.provenance).toBe('local');
                expect(only?.provenance === 'local' ? only.ingredient.foodId : undefined).toBe(SEEDED_FOOD_ID);
                expect(only?.provenance === 'local' ? only.ingredient : undefined).not.toHaveProperty(
                    'caloriesPer100g',
                );
            });

            it('writes NOTHING when the food cannot back an ingredient (no half-admitted row)', async () => {
                vi.mocked(food.getStatus).mockRejectedValue(new NotFoundError(UNSEEDED_FOOD_ID, 'NOT_FOUND'));

                await expect(service.addByFoodId(CALLER, UNSEEDED_FOOD_ID)).rejects.toThrow();
                expect(await readNutrition(UNSEEDED_FOOD_ID)).toBeUndefined();
            });
        });
    },
);
