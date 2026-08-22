/**
 * `IngredientsService.addByName` CONSULTS THE RESOLUTION CASCADE FIRST (plan U10 / R11, R19, AE6).
 *
 * This is the one integration point that makes the cascade reachable, and it is the point of the whole
 * learning loop: `POST /api/v1/ingredients/by-name` is where BOTH the picker and the cookbook importer land
 * (`RecipeApiClient` posts to it), so a curated mapping written by one cook is what resolves another cook's —
 * and every future import's — line without a food-service round trip.
 *
 * The four properties asserted, and why each is a property a mock CAN prove:
 *
 *  1. **A tier-1 hit admits by `food_id` and NEVER calls `foodClient.addByName`.** AE6's "resolves at the
 *     curated tier without an LLM call" is a statement about a call that does not happen, so the assertion is
 *     on the spy. It is also the U3 repair reaching further: admitting by `food_id` takes the display name
 *     from food-service's canonical record, so this is the one add path that structurally cannot mint caller
 *     prose into the ownerless catalog.
 *  2. ⛔ **A mapping whose food is NOT ADMISSIBLE falls through — it is never a `400`.** `food_id` has no
 *     foreign key and U12's reseed mints fresh food ULIDs, so a stale mapping is a certainty rather than a
 *     hazard. A cascade hit that turned into an error would take a whole class of ingredient adds down the
 *     day the catalog is reseeded, for a mapping the user never asked about.
 *  3. **An unattended caller's `authorId` reaches the cascade as `undefined`** (R22), so one user's private
 *     correction cannot silently rewrite an import.
 *  4. **An exhausted cascade leaves the shipped path byte-for-byte unchanged**, which is what makes this
 *     addition safe to land before U14 exposes any way to write a mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { IngredientsDal } from '../dal/ingredients.dal.js';
import { IngredientsService } from '../ingredients.service.js';
import type { ResolutionTier } from '../resolution/resolutionCascade.js';
import {
    CALLER_TOKEN as CALLER,
    makeAddResult,
    makeCanonicalName,
    makeFoodClients,
    makeFoodView,
    makeIngredient,
    makeStatusResult,
} from '../__fixtures__/ingredients.fixtures.js';

const MAPPED_FOOD = '01JU10WIRE0000000000MAPPED';
const AUTHOR = '01JU10WIRE0000000000AUTHOR';
const NAME = makeCanonicalName('plain flour');

/** A tier that resolves every query to `foodId`, recording the context it was handed. */
function hittingTier(foodId: string, seen: { authorId?: string | undefined }[]): ResolutionTier {
    return {
        id: 'curated',
        resolve: async (_query, context) => {
            seen.push({ authorId: context.authorId });

            return { kind: 'resolved', tier: 'curated', foodId, evidence: 'curated mapping (global, origin curator)' };
        },
    };
}

/** A tier that never resolves. */
const missingTier: ResolutionTier = {
    id: 'curated',
    resolve: async () => ({ kind: 'pass', tier: 'curated', reason: 'no mapping' }),
};

/** A fully mocked `IngredientsDal` with only the methods this path touches. */
function makeDal(overrides: Partial<Record<string, unknown>> = {}) {
    const mocks = {
        findByFoodId: vi.fn().mockResolvedValue(undefined),
        createFoodBacked: vi
            .fn()
            .mockImplementation(async (input: { name: string; foodId: string }) =>
                makeIngredient({ name: input.name, foodId: input.foodId }),
            ),
        updateResolution: vi.fn().mockImplementation(async () => makeIngredient({ foodId: MAPPED_FOOD })),
        ...overrides,
    };

    return { dal: mocks as unknown as IngredientsDal, mocks };
}

/** Build the service with a given tier chain. */
function build(tiers: readonly ResolutionTier[], dalOverrides: Partial<Record<string, unknown>> = {}) {
    const { dal, mocks } = makeDal(dalOverrides);
    const { clients, mocks: client } = makeFoodClients();
    const catalog = { search: vi.fn() } as unknown as FoodCatalogGateway;

    return { service: new IngredientsService(dal, clients, catalog, tiers), mocks, client };
}

describe('addByName — a curated mapping short-circuits the food-service round trip (AE6)', () => {
    it('admits the MAPPED food and never asks the food service to add by name', async () => {
        const seen: { authorId?: string | undefined }[] = [];
        const { service, client, mocks } = build([hittingTier(MAPPED_FOOD, seen)]);

        client.getStatus.mockResolvedValue(
            makeStatusResult({
                id: MAPPED_FOOD,
                status: 'RESOLVED',
                food: makeFoodView({ name: 'All-purpose flour' }),
            }),
        );

        const result = await service.addByName(CALLER, NAME, AUTHOR);

        // The assertion the requirement is actually about: the call that does NOT happen.
        expect(client.addByName).not.toHaveBeenCalled();
        expect(result.foodId).toBe(MAPPED_FOOD);
        // …and the row is named from food-service's canonical record, never from the caller's phrase (U3).
        expect(mocks['createFoodBacked']).toHaveBeenCalledWith(
            expect.objectContaining({ foodId: MAPPED_FOOD, name: 'All-purpose flour' }),
        );
    });

    it('passes an UNATTENDED caller through to the cascade as `undefined` (R22)', async () => {
        const seen: { authorId?: string | undefined }[] = [];
        const { service, client } = build([hittingTier(MAPPED_FOOD, seen)]);

        client.getStatus.mockResolvedValue(
            makeStatusResult({
                id: MAPPED_FOOD,
                status: 'RESOLVED',
                food: makeFoodView({ name: 'All-purpose flour' }),
            }),
        );

        await service.addByName(CALLER, NAME, undefined);

        expect(seen).toEqual([{ authorId: undefined }]);
    });
});

describe('addByName — a STALE mapping falls through, and is never an error', () => {
    it('resumes the ordinary path when the mapped food is no longer admissible', async () => {
        const seen: { authorId?: string | undefined }[] = [];
        const { service, client, mocks } = build([hittingTier(MAPPED_FOOD, seen)]);

        // ⛔ U12's reseed mints fresh food ULIDs and `ingredients.food_id` has NO foreign key, so a mapping
        // naming a food that no longer resolves is a certainty. `addByFoodId` answers that with
        // `UNKNOWN_INGREDIENT`, which is the right answer for a PICK (the user chose that row) and the wrong
        // one here (the user chose a NAME and knows nothing about the mapping).
        client.getStatus.mockResolvedValue(makeStatusResult({ id: MAPPED_FOOD, status: 'NOT_FOUND' }));
        client.addByName.mockResolvedValue(makeAddResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        const result = await service.addByName(CALLER, NAME, AUTHOR);

        expect(client.addByName).toHaveBeenCalledWith(NAME);
        expect(result.foodId).toBe('FRESH-FOOD');
        expect(mocks['createFoodBacked']).toHaveBeenCalledWith(
            expect.objectContaining({ foodId: 'FRESH-FOOD', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );
    });

    it('resumes the ordinary path when the cascade tier itself FAILS', async () => {
        const exploding: ResolutionTier = {
            id: 'curated',
            resolve: async () => {
                throw new Error('connection reset');
            },
        };
        const { service, client } = build([exploding]);

        client.addByName.mockResolvedValue(makeAddResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        // A blip on the mappings table must degrade the learning loop, never the ability to add an ingredient.
        await expect(service.addByName(CALLER, NAME, AUTHOR)).resolves.toMatchObject({ foodId: 'FRESH-FOOD' });
    });
});

describe('addByName — an exhausted cascade leaves the shipped path unchanged', () => {
    it('behaves exactly as before when nothing is mapped', async () => {
        const { service, client, mocks } = build([missingTier]);

        client.addByName.mockResolvedValue(makeAddResult({ id: 'FRESH-FOOD', status: 'UNRESOLVED' }));

        const result = await service.addByName(CALLER, NAME, AUTHOR);

        expect(client.addByName).toHaveBeenCalledWith(NAME);
        expect(mocks['createFoodBacked']).toHaveBeenCalledWith({
            name: NAME,
            foodId: 'FRESH-FOOD',
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        expect(result.foodId).toBe('FRESH-FOOD');
    });

    it('behaves exactly as before when NO tiers are registered at all', async () => {
        const { service, client } = build([]);

        client.addByName.mockResolvedValue(makeAddResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        await expect(service.addByName(CALLER, NAME, AUTHOR)).resolves.toMatchObject({ foodId: 'FRESH-FOOD' });
        expect(client.addByName).toHaveBeenCalledTimes(1);
    });
});
