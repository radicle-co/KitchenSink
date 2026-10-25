/**
 * `POST /api/v1/ingredients/by-name` binds only SETTLED evidence (ADR-0071), over the REAL HTTP pipeline with its
 * dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule`, the bindings and mappings repositories
 * doubled, and food faked at the network.
 *
 * A production paste matched "milk" to milk crackers. The by-name path ran the lexical tier, which proposes its top
 * catalog hit on any non-empty set, and that path BINDS. This suite proves the wiring production uses: with only a
 * catalog hit for the phrase, the route never searches the catalog and never binds the hit. A curated mapping still
 * binds, because a person said what the phrase means.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { ingredientSchema } from '@kitchensink/recipe-core';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { BoundArm, UnresolvedArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { admittedRefOf, type FoodAdmission } from '../../../src/ingredients/domain/foodAdmission.js';
import type { FailureFacts } from '../../../src/database/schema/foodLookupArm.js';
import {
    ResolutionMappingsDal,
    type MappingInForce,
} from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { makeUnresolvedArm } from '../../../src/ingredients/__fixtures__/foodLookups.fixture.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JBYNAMENORANKEDCOOK00001';
const AT = new Date('2026-10-25T00:00:00.000Z');

let food: FoodFake;
let booted: BootedServiceApp;
let curated: MappingInForce | undefined;

const findOrCreateBound = vi.fn(async (admission: FoodAdmission): Promise<BoundArm> => {
    const ref = admittedRefOf(admission);

    return { kind: 'root', lookupId: `lookup-${ref.id}`, foodId: ref.id, foodOwnerId: null, createdAt: AT };
});
const recordFailure = vi.fn(async (facts: FailureFacts): Promise<UnresolvedArm> =>
    makeUnresolvedArm({ failure: { ...facts, unresolvedFoodId: '00000000-0000-4000-8000-00000000fa12' } }),
);

/** The food API paths requested, without the client's one-time `/health` probe. */
function foodApiPaths(): readonly string[] {
    return food.requests.filter((request) => request.path.startsWith('/api/')).map((request) => request.path);
}

/** POST a phrase to the door as the cook. @sideEffect One HTTP request. */
async function addByName(name: string): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/ingredients/by-name`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify({ name }),
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    // The catalog holds a food whose name CONTAINS the phrase, so the fake's ranked search would answer it for "milk".
    food.foods.set('F-crackers', { name: 'Milk crackers', status: 'RESOLVED' });
    food.foods.set('F-whole', { name: 'Milk, whole', status: 'RESOLVED' });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: FoodLookupsDal,
                useValue: { findOrCreateBound, recordFailure, findConvergedFailure: async () => undefined },
            },
            {
                provide: ResolutionMappingsDal,
                useValue: { findInForce: async () => curated, findMemo: async () => undefined },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    curated = undefined;
    food.requests.length = 0;
    findOrCreateBound.mockClear();
    recordFailure.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/ingredients/by-name binds no ranked guess (integration)', () => {
    it('⛔ never searches the catalog and never binds its top hit when nothing settled names the phrase', async () => {
        const res = await addByName('milk');
        const ingredient = ingredientSchema.parse(await res.json());

        expect(res.status).toBe(202);
        expect(foodApiPaths()).not.toContain('/api/v1/foods/search');
        expect(findOrCreateBound).not.toHaveBeenCalled();
        expect(ingredient.foodId).toBeUndefined();
        // The ordinary path still runs: food is asked to add the phrase, and its answer is recorded.
        expect(foodApiPaths()).toContain('/api/v1/foods');
        expect(recordFailure).toHaveBeenCalledTimes(1);
    });

    it('still binds a CURATED mapping — a person said what the phrase means', async () => {
        curated = { id: 'mapping-1', food: { kind: 'root', id: 'F-whole' }, scope: 'global', origin: 'curator' };

        const res = await addByName('milk');
        const ingredient = ingredientSchema.parse(await res.json());

        expect(ingredient.foodId).toBe('F-whole');
        expect(findOrCreateBound).toHaveBeenCalledTimes(1);
        expect(foodApiPaths()).not.toContain('/api/v1/foods/search');
    });
});
