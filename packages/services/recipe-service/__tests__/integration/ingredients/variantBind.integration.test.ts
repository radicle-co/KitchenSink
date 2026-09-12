/**
 * `POST /api/v1/ingredients/by-food-variant` (curated plan U9; R20, R22) over the REAL HTTP pipeline, its dependencies
 * MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` with the bindings repository and the erasure jobs
 * doubled, and food faked at the network (`tests/support/foodFake.ts`), so the real food client serializes, forwards
 * the bearer and parses food's published refs answer.
 *
 * It proves what the unit tier cannot: that the door is routed, validated strictly, authenticated, rate-limited as a
 * write, that the caller's own credential reaches food, and that a bind is never made on no answer. The real SQL of
 * the variant binding is the LOCAL e2e tier's (`tests/e2e/foodLookupsDal.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { ingredientSchema } from '@kitchensink/recipe-core';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { BoundArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { admittedRefOf, type FoodAdmission } from '../../../src/ingredients/domain/foodAdmission.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JVARIANTBINDCOOK00000001';
const AT = new Date('2026-10-01T00:00:00.000Z');
const FLAT_PARTS = [{ attribute: 'cut', text: 'flat' }];

let food: FoodFake;
let booted: BootedServiceApp;

/** The repository double: one binding per admitted ref, as the real one finds or creates. */
const findOrCreateBound = vi.fn(async (admission: FoodAdmission): Promise<BoundArm> => {
    const ref = admittedRefOf(admission);

    return ref.kind === 'root'
        ? { kind: 'root', lookupId: `lookup-${ref.id}`, foodId: ref.id, foodOwnerId: admission.ownerId, createdAt: AT }
        : { kind: 'variant', lookupId: `lookup-${ref.id}`, foodVariantId: ref.id, createdAt: AT };
});

/** The requests food's API received, without the client's one-time `/health` skew probe. */
function foodApiRequests(): readonly (readonly [string, string | undefined])[] {
    return food.requests
        .filter((request) => request.path.startsWith('/api/'))
        .map((request) => [request.path, request.callerId] as const);
}

/**
 * POST a body to the door as the cook, forwarding the cook's bearer to food.
 *
 * @sideEffect One HTTP request.
 */
async function bindVariant(body: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/ingredients/by-food-variant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify(body),
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-brisket', { name: 'Beef brisket', status: 'RESOLVED' });
    food.foods.set('V-flat', { name: null, status: 'RESOLVED', variantOf: { rootId: 'R-brisket', parts: FLAT_PARTS } });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: FoodLookupsDal, useValue: { findOrCreateBound } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    food.down = false;
    food.requests.length = 0;
    findOrCreateBound.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/ingredients/by-food-variant (integration: real pipeline, mocked dependencies)', () => {
    it('binds the variant food names, asked as the caller, and answers its root and parts in the PUBLISHED shape', async () => {
        const res = await bindVariant({ foodVariantId: ' V-flat ' });
        const ingredient = ingredientSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(ingredient).toMatchObject({
            id: 'lookup-V-flat',
            name: 'Beef brisket',
            foodId: 'R-brisket',
            variant: { id: 'V-flat', parts: FLAT_PARTS },
            foodResolutionStatus: 'RESOLVED',
        });
        expect(foodApiRequests()).toStrictEqual([['/api/v1/foods/refs/resolve', COOK]]);
        expect(findOrCreateBound).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an unknown key beside the id', { foodVariantId: 'V-flat', name: 'flat brisket' }],
        ['a root id under the root’s key', { foodId: 'R-brisket' }],
        ['a blank id', { foodVariantId: '   ' }],
    ])('⛔ refuses %s with a 400, and never asks food', async (_case, body) => {
        const res = await bindVariant(body);
        const error = (await res.json()) as { code?: string };

        expect(res.status).toBe(400);
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(foodApiRequests()).toStrictEqual([]);
        expect(findOrCreateBound).not.toHaveBeenCalled();
    });

    it('⛔ refuses a variant food answers absent with UNKNOWN_INGREDIENT, and binds nothing', async () => {
        const res = await bindVariant({ foodVariantId: 'V-nope' });
        const error = (await res.json()) as { code?: string };

        expect(res.status).toBe(400);
        expect(error.code).toBe('UNKNOWN_INGREDIENT');
        expect(findOrCreateBound).not.toHaveBeenCalled();
    });

    it('⛔ answers 502 SOURCE_UNAVAILABLE when food is down — a bind is never made on no answer', async () => {
        food.down = true;

        const res = await bindVariant({ foodVariantId: 'V-flat' });
        const error = (await res.json()) as { code?: string };

        expect(res.status).toBe(502);
        expect(error.code).toBe('SOURCE_UNAVAILABLE');
        expect(findOrCreateBound).not.toHaveBeenCalled();
    });

    it('answers 401 with no credential, and never asks food', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/by-food-variant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ foodVariantId: 'V-flat' }),
        });

        expect(res.status).toBe(401);
        expect(foodApiRequests()).toStrictEqual([]);
    });
});
