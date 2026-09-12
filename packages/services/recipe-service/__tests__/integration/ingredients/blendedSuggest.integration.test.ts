/**
 * Stage 2 — BLENDED-TYPEAHEAD integration (`GET /api/v1/ingredients/suggest`) and the catalog PICK.
 *
 * Proven over the REAL {@link FoodLookupsDal} against Docker Postgres (migrated + seeded by
 * `tests/globalSetup.ts`) with only the external food service (003) stubbed — at the
 * {@link FoodCatalogGateway} boundary for the blend, and at the `FoodServiceClient` boundary for the pick.
 * That split matters: everything 001 owns (the SQL, the `food_id` crosswalk, the binding write) is real.
 *
 * What a mocked `db.execute` cannot prove, and this spec does:
 *   1. The `findBoundRootsByFoodIds` batch crosswalk actually resolves food ids to persisted bindings through
 *      real SQL, so the "appears once" dedup holds against the database rather than against a stub's return.
 *   2. **F1** — a catalog pick persists the food REFERENCE (a binding) in Postgres, and never a copy of food data.
 *   3. **F2** — a degraded food catalog still answers, promptly, from the real service.
 *
 * ⚠️ REWRITTEN (plan 002). Migration 0051 removed the recipe-side name catalog, so the typeahead has no
 * recipe-local TEXT search any more: its familiar ("local") section is exactly the catalog hits that already have
 * a binding the caller may see, named by FOOD's hit. What moved:
 *
 *  - "a persisted row the local text search missed is PROMOTED via the crosswalk" — the crosswalk is now the only
 *    way a food becomes familiar, so the case asserts the promoted ingredient's exact shape: the binding's id,
 *    FOOD's name, and no stored name at all.
 *  - F2 — a degraded catalog used to fall back to the recipe-local section. There is none; a degraded catalog now
 *    answers EMPTY with `catalogAvailability: 'unavailable'`, even for a food that has a binding (promotion needs
 *    the catalog's hits). The bounded-wait half is unchanged.
 *  - F1 — the pick asks food's `refs/resolve` before every bind (plan 002 R51), so it no longer short-circuits a
 *    second pick; the ONE-binding half of idempotence is unchanged. The pick persists no name, so "the persisted
 *    name is food's" became "the RETURNED name is food's, and the binding stores none". A pending by-name phrase
 *    is a failure record since 0051, not a food-backed row, so "backfills the existing row" became "reuses the
 *    existing binding".
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up simply skips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { FoodServiceClient, type FoodRef } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { CALLER_TOKEN as CALLER, foodClientsOf } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { ensureFoodLookup } from '../../../tests/support/lineChain.js';
import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';

const roleDb = recipeDb();
const hasDatabaseUrl = hasTestDatabase;

/** Food ids unique to this suite so its rows never collide with other integration specs. */
const SEEDED_FOOD_ID = '01JINGBLEND0000000000SEEDED';
const PROMOTED_FOOD_ID = '01JINGBLEND000000PROMOTED0';
const UNSEEDED_FOOD_ID = '01JINGBLEND00000UNSEEDED00';
const ALL_FOOD_IDS = [SEEDED_FOOD_ID, PROMOTED_FOOD_ID, UNSEEDED_FOOD_ID];

/** A name stem unique to this suite. */
const STEM = 'Zorbulax';

/** A gateway double: the blend's only external dependency, stubbed at the availability boundary. */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn() } as unknown as FoodCatalogGateway;
}

/**
 * A food-client double: only the `resolveRefs` the pick path reads (R51). It answers `found` + `RESOLVED` for a
 * food in `names`, under that name, and `absent` for anything else — the entry an unknown id gets.
 */
function makeFoodClientStub(names: ReadonlyMap<string, string>): FoodServiceClient {
    return {
        resolveRefs: vi.fn(async (refs: readonly FoodRef[]) => ({
            entries: refs.map((ref) => {
                const name = names.get(ref.id);

                return name === undefined
                    ? { outcome: 'absent' as const, ref }
                    : { outcome: 'found' as const, ref, name, status: 'RESOLVED' as const };
            }),
        })),
    } as unknown as FoodServiceClient;
}

describe.skipIf(!hasDatabaseUrl)(
    'blended ingredient suggest (integration: service + real DAL + stubbed food service)',
    () => {
        let pool: pg.Pool;
        let db: RecipeDrizzle;
        let catalog: FoodCatalogGateway;
        let foodNames: Map<string, string>;
        let food: FoodServiceClient;
        let service: IngredientsService;

        /** A service over the real DAL, with the given catalog gateway. */
        function serviceWith(gateway: FoodCatalogGateway): IngredientsService {
            return new IngredientsService(
                new FoodLookupsDal(db),
                foodClientsOf(food),
                gateway,
                new FoodRefsGateway(foodClientsOf(food)),
                [],
                makeFakeIngredientResolutionsDal(),
                makeFakeResolutionBandsDal(),
            );
        }

        beforeAll(() => {
            pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
            db = createRecipeDrizzle(pool);
        });

        afterAll(async () => {
            await cleanup();
            await pool.end();
        });

        beforeEach(async () => {
            await cleanup();
            catalog = makeCatalogStub();
            foodNames = new Map();
            food = makeFoodClientStub(foodNames);
            service = serviceWith(catalog);
        });

        /** Remove every binding this suite could have created (none is referenced by a line). */
        async function cleanup(): Promise<void> {
            await pool.query('DELETE FROM food_lookups WHERE food_id = ANY($1)', [ALL_FOOD_IDS]);
        }

        /** Re-read a food's binding STRAIGHT from Postgres (not the service's return value). */
        async function readBinding(foodId: string): Promise<Record<string, unknown> | undefined> {
            const { rows } = await pool.query<Record<string, unknown>>(
                `SELECT id, food_id, food_variant_id, unresolved_food_id, food_owner_id
                   FROM food_lookups WHERE food_id = $1`,
                [foodId],
            );

            return rows[0];
        }

        describe('the blend', () => {
            it('surfaces a food-catalog hit that has NO binding (the whole point of Stage 2)', async () => {
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

            it('deduplicates through REAL SQL: a food with a persisted binding appears once, as `local`', async () => {
                await ensureFoodLookup(pool, { arm: 'shared', foodId: SEEDED_FOOD_ID });
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: SEEDED_FOOD_ID, name: `${STEM} golden name`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.suggestions).toHaveLength(1);
                expect(result.suggestions[0]?.provenance).toBe('local');
            });

            it('PROMOTES a bound food through the real batch crosswalk, named by FOOD', async () => {
                const lookupId = await ensureFoodLookup(pool, { arm: 'shared', foodId: PROMOTED_FOOD_ID });
                vi.mocked(catalog.search).mockResolvedValue({
                    hits: [{ foodId: PROMOTED_FOOD_ID, name: `${STEM} golden name`, score: 0.9 }],
                    availability: 'ok',
                });

                const result = await service.suggest(CALLER, STEM);

                expect(result.suggestions).toEqual([
                    {
                        provenance: 'local',
                        ingredient: {
                            id: lookupId,
                            name: `${STEM} golden name`,
                            foodId: PROMOTED_FOOD_ID,
                            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                            isUserEntered: false,
                            createdAt: expect.any(String),
                        },
                    },
                ]);
            });

            it('F2 — a degraded catalog answers EMPTY and unavailable, even for a bound food', async () => {
                await ensureFoodLookup(pool, { arm: 'shared', foodId: SEEDED_FOOD_ID });
                vi.mocked(catalog.search).mockResolvedValue({ hits: [], availability: 'unavailable' });

                const result = await service.suggest(CALLER, STEM);

                expect(result).toEqual({ suggestions: [], catalogAvailability: 'unavailable' });
            });

            it('F2 — a HUNG food service really does time out, through the real client + real gateway', async () => {
                // The production mechanism end-to-end, nothing about the degradation hand-stubbed: a real
                // `FoodServiceClient` with the typeahead's short timeout, a `fetch` that never resolves, and the
                // real `FoodCatalogGateway`. The client's own `AbortSignal` fires, raises
                // `FetchUnavailableError`, and the gateway turns that into an unavailable render.
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

                const startedAt = Date.now();
                const result = await serviceWith(realGateway).suggest(CALLER, STEM);
                const elapsed = Date.now() - startedAt;

                expect(result).toEqual({ suggestions: [], catalogAvailability: 'unavailable' });
                // The wait is BOUNDED by the timeout — the whole point of F2. Generous upper bound so the
                // assertion is about the bound existing, not about CI scheduling jitter.
                expect(elapsed).toBeLessThan(5_000);
            });
        });

        describe('F1 — the pick persists the food REFERENCE into POSTGRES, never a copy of the food data', () => {
            it('binds a catalog hit and persists the food id on the root arm', async () => {
                foodNames.set(SEEDED_FOOD_ID, `${STEM} chicken breast`);

                const ingredient = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                // ⛔ NO nutrition on the returned ingredient (U10). The numbers are food's and are read
                // live; a copy here is the snapshot-with-no-invalidation KTD-3 deletes.
                expect(ingredient).not.toHaveProperty('caloriesPer100g');
                expect(ingredient).not.toHaveProperty('portions');
                expect(ingredient.foodResolutionStatus).toBe('RESOLVED');
                expect(ingredient.isUserEntered).toBe(false);

                // …and the binding, re-read from the database: the root arm, and nothing else.
                expect(await readBinding(SEEDED_FOOD_ID)).toEqual({
                    id: ingredient.id,
                    food_id: SEEDED_FOOD_ID,
                    food_variant_id: null,
                    unresolved_food_id: null,
                    food_owner_id: null,
                });
            });

            it('takes the name from food-service, and stores none of its own', async () => {
                foodNames.set(SEEDED_FOOD_ID, `${STEM} authoritative`);

                const ingredient = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect(ingredient.name).toBe(`${STEM} authoritative`);
                expect(await readBinding(SEEDED_FOOD_ID)).not.toHaveProperty('name');
            });

            it('is idempotent: a second pick of the same food leaves ONE binding, asking food each time (R51)', async () => {
                foodNames.set(SEEDED_FOOD_ID, `${STEM} chicken breast`);

                const first = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);
                const second = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect(second.id).toBe(first.id);
                const { rows } = await pool.query<{ n: number }>(
                    'SELECT count(*)::int AS n FROM food_lookups WHERE food_id = $1',
                    [SEEDED_FOOD_ID],
                );
                expect(rows[0]?.n).toBe(1);
                // Every bind is made on food's answer about the food, never on a remembered one.
                expect(vi.mocked(food.resolveRefs)).toHaveBeenCalledTimes(2);
            });

            it('REUSES an existing binding for the food rather than duplicating it', async () => {
                const existing = await ensureFoodLookup(pool, { arm: 'shared', foodId: SEEDED_FOOD_ID });
                foodNames.set(SEEDED_FOOD_ID, `${STEM} golden`);

                const ingredient = await service.addByFoodId(CALLER, SEEDED_FOOD_ID);

                expect(ingredient.id).toBe(existing);
                expect(ingredient.name).toBe(`${STEM} golden`);
            });

            it('a picked-then-suggested food comes back as a `local` suggestion carrying its food reference', async () => {
                // The end-to-end Stage-2 loop: pick a catalog hit, then type the same query again.
                foodNames.set(SEEDED_FOOD_ID, `${STEM} chicken breast`);
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
                expect(only?.provenance === 'local' ? only.ingredient.foodId : undefined).toBe(SEEDED_FOOD_ID);
                expect(only?.provenance === 'local' ? only.ingredient : undefined).not.toHaveProperty(
                    'caloriesPer100g',
                );
            });

            it('writes NOTHING when the food cannot back an ingredient (no half-admitted binding)', async () => {
                // `foodNames` holds nothing, so food answers `absent` — the same answer an unknown id gets.
                // Refused as food's answer (UNKNOWN_INGREDIENT), not as a transport failure or a broken stub.
                await expect(service.addByFoodId(CALLER, UNSEEDED_FOOD_ID)).rejects.toMatchObject({
                    code: 'UNKNOWN_INGREDIENT',
                    details: { foodId: UNSEEDED_FOOD_ID },
                });
                expect(await readBinding(UNSEEDED_FOOD_ID)).toBeUndefined();
            });
        });
    },
);
