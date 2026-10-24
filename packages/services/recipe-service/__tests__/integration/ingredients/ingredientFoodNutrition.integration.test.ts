/**
 * `POST /api/v1/ingredients/food-nutrition` (plan 002 U9) over the REAL HTTP pipeline, with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` — auth middleware, validation pipe, throttler and erasure
 * guards, exception filter — with the bindings repository and the erasure jobs replaced by doubles, and food faked at
 * the network (`tests/support/foodFake.ts`), so the real food client serializes, forwards the bearer and parses.
 *
 * It proves what the unit tier cannot: that the route is wired, authenticated, validated and exempt from the erasure
 * lock in the running app, that the caller's credential reaches food, and that on the wire a stranger's private food
 * is indistinguishable from an unknown id. That the concealment holds when food itself is wrong is the unit tier's
 * (`foodNutritionAnswer.test.ts`); the real SQL behind `findPrivateRootOwners` is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const CALLER = '01JFOODNUTRITIONCALLER00001';
const ERASING = '01JFOODNUTRITIONERASING0002';
const STRANGER = '01JFOODNUTRITIONSTRANGER003';

/** The private bindings this service holds. */
const OWNERS = new Map([
    ['mine', CALLER],
    ['theirs', STRANGER],
]);

let food: FoodFake;
let booted: BootedServiceApp;

/** The requests food's API received, leaving out the client's one-time contract-skew probe of `/health`. */
function foodApiRequests(): readonly (readonly [string, string | undefined])[] {
    return food.requests
        .filter((request) => request.path.startsWith('/api/'))
        .map((request) => [request.path, request.callerId] as const);
}

/**
 * POST a body as `userId`, forwarding that user's bearer to food.
 *
 * @sideEffect One HTTP request under the dev-bypass identity `userId`.
 */
async function post(path: string, body: unknown, userId: string = CALLER): Promise<Response> {
    return asPrincipal(userId, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(userId) },
            body: JSON.stringify(body),
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('public', { name: 'Apple', status: 'RESOLVED', caloriesPer100g: 52 });
    food.foods.set('plain', { name: 'Pear', status: 'RESOLVED', caloriesPer100g: 57 });
    food.foods.set('mine', { name: 'My blend', status: 'RESOLVED', ownerId: CALLER, caloriesPer100g: 90 });
    food.foods.set('theirs', { name: 'Their blend', status: 'RESOLVED', ownerId: STRANGER, caloriesPer100g: 300 });
    food.foods.set('flat', {
        name: null,
        status: 'RESOLVED',
        caloriesPer100g: 155,
        variantOf: { rootId: 'public', parts: [{ attribute: 'cut', text: 'flat' }] },
    });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: FoodLookupsDal,
                useValue: {
                    findPrivateRootOwners: async (ids: readonly string[]) =>
                        new Map(ids.flatMap((id) => (OWNERS.has(id) ? [[id, OWNERS.get(id) ?? ''] as const] : []))),
                },
            },
            {
                provide: ErasureJobsDal,
                useValue: {
                    findActiveJob: async (ownerId: string) =>
                        ownerId === ERASING
                            ? { id: '00000000-0000-4000-8000-000000000e1a', status: 'running' }
                            : undefined,
                },
            },
        ],
    });
});

afterEach(() => {
    food.down = false;
    food.requests.length = 0;
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/ingredients/food-nutrition (integration: real pipeline, mocked dependencies)', () => {
    it('⛔ answers a stranger’s private food exactly as an unknown id, and the caller’s own as found', async () => {
        const res = await post('/api/v1/ingredients/food-nutrition', {
            refs: [
                { kind: 'root', id: 'public' },
                { kind: 'root', id: 'mine' },
                { kind: 'root', id: 'theirs' },
                { kind: 'root', id: 'unknown' },
                { kind: 'variant', id: 'v1' },
            ],
        });
        const { entries } = (await res.json()) as { entries: readonly { outcome: string; ref: unknown }[] };

        expect(res.status).toBe(200);
        // `v1` names nothing food holds; it is absent because food said so (curated U9), not by a recipe-side rule.
        expect(entries.map((entry) => entry.outcome)).toStrictEqual(['found', 'found', 'absent', 'absent', 'absent']);
        // Apart from the echoed ref, the stranger's entry and the unknown id's are the same bytes.
        const { ref: _theirs, ...theirs } = entries[2] as { ref: unknown };
        const { ref: _unknown, ...unknown } = entries[3] as { ref: unknown };

        expect(theirs).toStrictEqual(unknown);
        // The caller's own credential reached food, on the shared route and then on the per-caller one.
        expect(foodApiRequests()).toStrictEqual([
            ['/api/v1/foods/nutrition', CALLER],
            ['/api/v1/foods/authored-nutrition', CALLER],
        ]);
    });

    // Rewritten for curated U9: a variant ref used to answer `absent` without asking food. Rewritten again for
    // blueprint decision 4: the root `public` has the live variant `flat`, so its entry now says so; the variant's never.
    it('answers a VARIANT from food’s own numbers for it, asked as the caller (curated U9, R21)', async () => {
        const res = await post('/api/v1/ingredients/food-nutrition', {
            refs: [
                { kind: 'variant', id: 'flat' },
                { kind: 'root', id: 'public' },
            ],
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({
            entries: [
                {
                    outcome: 'found',
                    ref: { kind: 'variant', id: 'flat' },
                    freshness: 'fresh',
                    caloriesPer100g: 155,
                    portions: [],
                },
                {
                    outcome: 'found',
                    ref: { kind: 'root', id: 'public' },
                    freshness: 'fresh',
                    caloriesPer100g: 52,
                    portions: [],
                    hasVariants: true,
                },
            ],
        });
        expect(foodApiRequests()).toContainEqual(['/api/v1/foods/nutrition', CALLER]);
    });

    describe('hasVariants on a found root (blueprint decision 4)', () => {
        it('states false for a catalog root with no live variant, and nothing for an authored food', async () => {
            const res = await post('/api/v1/ingredients/food-nutrition', {
                refs: [
                    { kind: 'root', id: 'plain' },
                    { kind: 'root', id: 'mine' },
                ],
            });
            const { entries } = (await res.json()) as { entries: readonly Record<string, unknown>[] };

            expect(res.status).toBe(200);
            expect(entries[0]).toMatchObject({ outcome: 'found', hasVariants: false });
            // Food's authored route never states it: not known is absent, never a guessed `false`.
            expect(entries[1]).toMatchObject({ outcome: 'found', ref: { kind: 'root', id: 'mine' } });
            expect(entries[1]).not.toHaveProperty('hasVariants');
        });

        it('keeps the cached value, marked stale with the numbers, when food goes down', async () => {
            // The fresh read warms this app's cache; the stale read must not rely on another test having done it.
            const fresh = await post('/api/v1/ingredients/food-nutrition', { refs: [{ kind: 'root', id: 'public' }] });

            expect(await fresh.json()).toMatchObject({ entries: [{ freshness: 'fresh', hasVariants: true }] });

            food.down = true;

            const stale = await post('/api/v1/ingredients/food-nutrition', { refs: [{ kind: 'root', id: 'public' }] });

            expect(await stale.json()).toStrictEqual({
                entries: [
                    {
                        outcome: 'found',
                        ref: { kind: 'root', id: 'public' },
                        freshness: 'stale',
                        caloriesPer100g: 52,
                        portions: [],
                        hasVariants: true,
                    },
                ],
            });
        });
    });

    it('answers every root unavailable when food is down, the stranger’s private food included', async () => {
        food.down = true;

        const res = await post('/api/v1/ingredients/food-nutrition', {
            refs: [
                { kind: 'root', id: 'theirs' },
                { kind: 'root', id: 'unknown' },
            ],
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({
            entries: [
                { outcome: 'unavailable', ref: { kind: 'root', id: 'theirs' } },
                { outcome: 'unavailable', ref: { kind: 'root', id: 'unknown' } },
            ],
        });
    });

    it('tells every cache not to keep the answer', async () => {
        const res = await post('/api/v1/ingredients/food-nutrition', { refs: [{ kind: 'root', id: 'public' }] });

        expect(res.headers.get('cache-control')).toBe('private, no-store');
    });

    it('⛔ answers 200 during the caller’s own erasure, where a write answers 423', async () => {
        // Positive control: a non-exempt POST from the same caller is refused by the erasure guard.
        const write = await post('/api/v1/ingredients', { name: 'shallot' }, ERASING);
        const read = await post(
            '/api/v1/ingredients/food-nutrition',
            { refs: [{ kind: 'root', id: 'public' }] },
            ERASING,
        );

        expect(write.status).toBe(423);
        expect(read.status).toBe(200);
    });

    it('refuses an unknown key with a 400 and the house error body, and never asks food', async () => {
        const res = await post('/api/v1/ingredients/food-nutrition', {
            refs: [{ kind: 'root', id: 'public', ownerId: CALLER }],
        });
        const body = (await res.json()) as { code?: string };

        expect(res.status).toBe(400);
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(foodApiRequests()).toStrictEqual([]);
    });

    it('answers 401 with no credential at all, and never asks food', async () => {
        // Outside `asPrincipal` the dev bypass is off: no principal and no bearer.
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/food-nutrition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refs: [{ kind: 'root', id: 'public' }] }),
        });

        expect(res.status).toBe(401);
        expect(foodApiRequests()).toStrictEqual([]);
    });
});
