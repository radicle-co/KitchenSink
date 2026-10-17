/**
 * The catalog PICK (`POST /api/v1/ingredients/by-food`) and the filter's search (`GET /api/v1/ingredients/search`).
 *
 * Proven over the REAL {@link FoodLookupsDal} against Docker Postgres (migrated + seeded by
 * `tests/globalSetup.ts`) with only the external food service (003) stubbed — at the
 * {@link FoodCatalogGateway} boundary for the search, and at the `FoodServiceClient` boundary for the pick.
 * That split matters: everything 001 owns (the SQL, the `food_id` crosswalk, the binding write) is real.
 *
 * What a mocked `db.execute` cannot prove, and this spec does:
 *   1. The `findBoundRootsByFoodIds` batch crosswalk resolves food ids to persisted bindings through real SQL, so the
 *      search returns exactly the hits some binding holds, named by FOOD's hit.
 *   2. **F1** — a catalog pick persists the food REFERENCE (a binding) in Postgres, and never a copy of food data.
 *
 * ⚠️ REWRITTEN (plan 002 S6). This suite proved the blended `/suggest` typeahead, which S6 deleted with the rest of
 * the search proxy (ADR-0046). Its crosswalk case moved onto `/search`, which reads the same crosswalk; the bounded
 * wait on a hung food service is `foodTokenForwarding.integration.test.ts`'s, on the gateway `/search` reads through.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { FoodRef, FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { CALLER_TOKEN as CALLER, foodClientsOf } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { ensureFoodLookup } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';

const roleDb = recipeDb();
/** Food ids unique to this suite so its rows never collide with other integration specs. */
const SEEDED_FOOD_ID = '01JINGBLEND0000000000SEEDED';
const PROMOTED_FOOD_ID = '01JINGBLEND000000PROMOTED0';
const UNSEEDED_FOOD_ID = '01JINGBLEND00000UNSEEDED00';
const ALL_FOOD_IDS = [SEEDED_FOOD_ID, PROMOTED_FOOD_ID, UNSEEDED_FOOD_ID];

/** A name stem unique to this suite. */
const STEM = 'Zorbulax';

/** A gateway double: the search's only external dependency, stubbed at the availability boundary. */
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

describe('catalog pick and filter search (integration: service + real DAL + stubbed food service)', () => {
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

    describe('the filter search', () => {
        it('returns the bound food among food’s hits through the real crosswalk, named by FOOD', async () => {
            const lookupId = await ensureFoodLookup(pool, { arm: 'shared', foodId: PROMOTED_FOOD_ID });
            vi.mocked(catalog.search).mockResolvedValue({
                hits: [
                    { foodId: PROMOTED_FOOD_ID, name: `${STEM} golden name`, score: 0.9 },
                    { foodId: UNSEEDED_FOOD_ID, name: `${STEM} catalog only`, score: 0.8 },
                ],
                availability: 'ok',
            });

            const result = await service.search(CALLER, STEM);

            // The unbound hit is left out: a filter value no recipe binds would match nothing (R45).
            expect(result).toEqual([
                {
                    id: lookupId,
                    name: `${STEM} golden name`,
                    foodId: PROMOTED_FOOD_ID,
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                    isUserEntered: false,
                    createdAt: expect.any(String),
                },
            ]);
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
});
