/**
 * `POST /api/v1/ingredients/by-name` binds NOTHING a tier remembers, and `GET .../by-name/proposals` OFFERS it (ADR-0071
 * as amended, owner rulings 2026-11-03), over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule`, the bindings and mappings repositories doubled, and food
 * faked at the network.
 *
 * A production paste matched "milk" to milk crackers (the lexical tier bound its top catalog hit), and devil's advocate M2
 * found the same silent bind through a memo another cook's save had taught. So: with only a catalog hit for the phrase the
 * route never searches the catalog and never binds the hit, and a remembered answer (the cook's own correction, a staff
 * ruling, a memo) no longer binds either. The proposals route offers those answers and writes nothing.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { ingredientSchema } from '@kitchensink/recipe-core';
import { ingredientNameProposalsResponseSchema } from '@kitchensink/schema-recipe';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { BoundArm, UnresolvedArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { admittedRefOf, type FoodAdmission } from '../../../src/ingredients/domain/foodAdmission.js';
import type { FailureFacts } from '../../../src/database/schema/foodLookupArm.js';
import {
    ResolutionMappingsDal,
    type MappingInForce,
    type MemoHit,
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
let remembered: MemoHit | undefined;

const findOrCreateBound = vi.fn(async (admission: FoodAdmission): Promise<BoundArm> => {
    const ref = admittedRefOf(admission);

    return { kind: 'root', lookupId: `lookup-${ref.id}`, foodId: ref.id, foodOwnerId: null, createdAt: AT };
});
const findInForce = vi.fn(async () => curated);
const findMemo = vi.fn(async () => remembered);
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
                useValue: { findInForce, findMemo },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    curated = undefined;
    remembered = undefined;
    findInForce.mockClear();
    findMemo.mockClear();
    food.requests.length = 0;
    findOrCreateBound.mockClear();
    recordFailure.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

/** GET the proposals for a phrase as the cook. @sideEffect One HTTP request. */
async function proposalsFor(name: string): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/ingredients/by-name/proposals?name=${encodeURIComponent(name)}`, {
            headers: { authorization: bearerFor(COOK) },
        }),
    );
}

describe('POST /api/v1/ingredients/by-name binds nothing a tier remembers (integration)', () => {
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

    it('⛔ does NOT bind a curated mapping or a memo: the editor only proposes what is remembered', async () => {
        curated = { id: 'mapping-1', food: { kind: 'root', id: 'F-whole' }, scope: 'global', origin: 'curator' };
        remembered = { food: { kind: 'root', id: 'F-crackers' }, match: 'exact', similarity: 1 };

        const res = await addByName('milk');
        const ingredient = ingredientSchema.parse(await res.json());

        expect(res.status).toBe(202);
        expect(findInForce).not.toHaveBeenCalled();
        expect(findMemo).not.toHaveBeenCalled();
        expect(findOrCreateBound).not.toHaveBeenCalled();
        expect(ingredient.foodId).toBeUndefined();
    });
});

describe('GET /api/v1/ingredients/by-name/proposals offers what is remembered and writes nothing (integration)', () => {
    it('offers a staff ruling and a memo, named by food as the cook, strongest source first', async () => {
        curated = { id: 'mapping-1', food: { kind: 'root', id: 'F-whole' }, scope: 'global', origin: 'curator' };
        remembered = { food: { kind: 'root', id: 'F-crackers' }, match: 'exact', similarity: 1 };

        const res = await proposalsFor('milk');
        const answer = ingredientNameProposalsResponseSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(answer).toStrictEqual({
            phrase: 'milk',
            proposals: [
                { kind: 'root', id: 'F-whole', name: 'Milk, whole', source: 'staffRuling' },
                { kind: 'root', id: 'F-crackers', name: 'Milk crackers', source: 'remembered' },
            ],
        });
    });

    it('offers the cook their OWN correction first, and a memo beside it', async () => {
        curated = { id: 'mapping-2', food: { kind: 'root', id: 'F-whole' }, scope: 'author', origin: 'author' };
        remembered = { food: { kind: 'root', id: 'F-crackers' }, match: 'exact', similarity: 1 };

        const answer = ingredientNameProposalsResponseSchema.parse(await (await proposalsFor('milk')).json());

        expect(answer.proposals.map((proposal) => proposal.source)).toStrictEqual(['ownCorrection', 'remembered']);
    });

    it('⛔ writes nothing: no binding, no failure record, no catalog search, no add-by-name', async () => {
        curated = { id: 'mapping-1', food: { kind: 'root', id: 'F-whole' }, scope: 'global', origin: 'curator' };

        await proposalsFor('milk');

        expect(findOrCreateBound).not.toHaveBeenCalled();
        expect(recordFailure).not.toHaveBeenCalled();
        expect(foodApiPaths()).not.toContain('/api/v1/foods/search');
        expect(foodApiPaths()).not.toContain('/api/v1/foods');
    });

    it('answers an empty list, still 200, when nothing is remembered', async () => {
        const res = await proposalsFor('milk');

        expect(res.status).toBe(200);
        expect(ingredientNameProposalsResponseSchema.parse(await res.json())).toStrictEqual({
            phrase: 'milk',
            proposals: [],
        });
    });

    it('drops a remembered food food no longer shows, instead of failing the read', async () => {
        curated = { id: 'mapping-3', food: { kind: 'root', id: 'F-gone' }, scope: 'global', origin: 'curator' };

        const res = await proposalsFor('milk');

        expect(res.status).toBe(200);
        expect(ingredientNameProposalsResponseSchema.parse(await res.json()).proposals).toStrictEqual([]);
    });

    it('rejects a blank name with 400', async () => {
        expect((await proposalsFor('   ')).status).toBe(400);
    });
});
