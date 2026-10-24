/**
 * T028/T029/T067 — ingredient async-resolution ADD-BY-NAME integration (data-model R5).
 *
 * The entry point of the async-resolution vertical, proven over the REAL {@link FoodLookupsDal} against
 * Docker Postgres (migrated + seeded by `tests/globalSetup.ts`) with the external food service (003)
 * stubbed at the `FoodServiceClient` boundary — the one dependency 001 does not own. This proves what a
 * mocked `db.execute` cannot: `addByName` actually WRITES the rows the picker polls, through the real SQL.
 *
 * ⚠️ REWRITTEN (plan 002). Migration 0051 replaced the shared name catalog with a BINDING (`food_lookups`) that
 * names exactly one of a food or a FAILURE RECORD (`unresolved_foods`). The three behaviours moved accordingly:
 *
 *  - A PENDING or UNRESOLVED answer is not a food-backed row any more: it is a failure record carrying food's
 *    handle (`food_handle_id`) with the matching reason, and the line's binding is on the UNRESOLVED arm. So the
 *    returned ingredient carries no `foodId` (was: the food id), and the persisted status is READ from the failure
 *    record's generated `status` (was: `ingredients.food_resolution_status`).
 *  - "Dedup on food_id" still holds, for the food a binding NAMES: food resolving two different phrases to one
 *    food binds both to ONE `food_lookups` row. A still-pending phrase converges on its normalized KEY instead,
 *    which `tests/e2e/foodLookupsDal.e2e.test.ts` owns.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { FoodRef, FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeAddResult,
    makeCanonicalName,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { readFailureRecord } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';

const roleDb = recipeDb();
/** Food ids unique to this suite so its rows never collide with other integration specs. */
const PENDING_FOOD_ID = '01JINGADDBYNAME00000PENDING';
const UNRESOLVED_FOOD_ID = '01JINGADDBYNAME000UNRESOLV0';
const RESOLVED_FOOD_ID = '01JINGADDBYNAME0000RESOLVED';
const SUITE_FOOD_IDS = [PENDING_FOOD_ID, UNRESOLVED_FOOD_ID, RESOLVED_FOOD_ID];

/** Food's canonical name for {@link RESOLVED_FOOD_ID}, as its `refs/resolve` answers it. */
const RESOLVED_FOOD_NAME = 'Quinoa, uncooked';

/**
 * A minimally-stubbed food client: `addByName`, and `resolveRefs` — food's answer about the one food a RESOLVED
 * add is about to bind (R51), naming {@link RESOLVED_FOOD_ID} and nothing else.
 */
function makeFoodClientStub(): FoodServiceClient {
    return {
        addByName: vi.fn(),
        resolveRefs: vi.fn(async (refs: readonly FoodRef[]) => ({
            entries: refs.map((ref) =>
                ref.id === RESOLVED_FOOD_ID
                    ? { outcome: 'found' as const, ref, name: RESOLVED_FOOD_NAME, status: 'RESOLVED' as const }
                    : { outcome: 'absent' as const, ref },
            ),
        })),
    } as unknown as FoodServiceClient;
}

/** A no-op catalog gateway — the by-name path never blends (see `blendedSuggest.integration.test.ts`). */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
}

describe('ingredient addByName (integration: service + real DAL + stubbed food client)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let food: FoodServiceClient;
    let service: IngredientsService;

    /** Remove every binding and failure record this suite's foods produced. */
    async function removeSuiteRows(): Promise<void> {
        await pool.query(
            `DELETE FROM food_lookups
              WHERE food_id = ANY($1)
                 OR unresolved_food_id IN (SELECT id FROM unresolved_foods WHERE food_handle_id = ANY($1))`,
            [SUITE_FOOD_IDS],
        );
        await pool.query('DELETE FROM unresolved_foods WHERE food_handle_id = ANY($1)', [SUITE_FOOD_IDS]);
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await removeSuiteRows();
        await pool.end();
    });

    beforeEach(async () => {
        await removeSuiteRows();
        food = makeFoodClientStub();
        service = new IngredientsService(
            new FoodLookupsDal(db),
            foodClientsOf(food),
            makeCatalogStub(),
            new FoodRefsGateway(foodClientsOf(food)),
            [],
            makeFakeIngredientResolutionsDal(),
            makeFakeResolutionBandsDal(),
        );
    });

    it('adds a PENDING food and PERSISTS a failure record carrying food`s handle (poll-able by the picker)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: PENDING_FOOD_ID, status: FoodResolutionStatus.PENDING }),
        );

        const ingredient = await service.addByName(CALLER, makeCanonicalName('  Quinoa integration  '));

        // The food client saw the TRIMMED name; the returned binding is the non-terminal, unresolved one.
        expect(food.addByName).toHaveBeenCalledWith('Quinoa integration');
        expect(ingredient.foodId).toBeUndefined();
        expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
        expect(ingredient.isUserEntered).toBe(false);

        // Re-read from the DB: the record was actually written through (not just returned in-memory), and it holds
        // the handle the poll will follow.
        expect(await readFailureRecord(pool, ingredient.id)).toEqual({
            reasonCode: 'awaiting_source',
            status: 'PENDING',
            foodHandleId: PENDING_FOOD_ID,
            name: 'Quinoa integration',
        });
    });

    it('adds an UNRESOLVED food and persists its UNRESOLVED status (drives disambiguation)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: UNRESOLVED_FOOD_ID, status: FoodResolutionStatus.UNRESOLVED }),
        );

        const ingredient = await service.addByName(CALLER, makeCanonicalName('Ambiguous integration'));

        expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        expect(await readFailureRecord(pool, ingredient.id)).toEqual({
            reasonCode: 'several_candidates',
            status: 'UNRESOLVED',
            foodHandleId: UNRESOLVED_FOOD_ID,
            name: 'Ambiguous integration',
        });
    });

    it('dedups on food_id: two phrases food resolves to ONE food bind to ONE binding (one DB row)', async () => {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: RESOLVED_FOOD_ID, status: FoodResolutionStatus.RESOLVED }),
        );

        const first = await service.addByName(CALLER, makeCanonicalName('Quinoa integration'));
        const second = await service.addByName(CALLER, makeCanonicalName('Quinoa integration again'));

        expect(second.id).toBe(first.id);
        // Named by FOOD, never by either caller phrase.
        expect([first.name, second.name]).toEqual([RESOLVED_FOOD_NAME, RESOLVED_FOOD_NAME]);
        expect(first.foodId).toBe(RESOLVED_FOOD_ID);

        const { rows } = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM food_lookups WHERE food_id = $1',
            [RESOLVED_FOOD_ID],
        );
        expect(rows[0]?.n).toBe(1);
    });
});
