/**
 * Public recipes hold no private food (ADR-0029 section 4; owner rulings 2026-11-08) over the REAL HTTP pipeline with its
 * dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` - Nest's router, the zod pipes, the auth
 * middleware verifying a SIGNED token, `RecipesService`, the public-foods rule, the exception filter - with the recipe
 * DAL, the food bindings (`FoodLookupsDal`) and food's answers (`FoodRefsGateway`) replaced by doubles.
 *
 * It pins what the unit tier cannot: that the refusal reaches the wire as the published `400
 * PRIVATE_FOODS_ON_PUBLIC_RECIPE` envelope, parsed with the service's own typed error schema, so a body that drops a
 * line's `sortOrder` or `foodId` fails here; on create, update and set-visibility; and that nothing is written. Whether
 * the database's own last check finds the right rows is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import type { RecipeVisibility } from '@kitchensink/recipe-core';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { FoodRefAnswer } from '../../../src/ingredients/domain/foodRefAnswer.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import type { RecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const AZP = 'https://recipes.example.com';
const COOK = '01JPUBF00DS1NTEGRAT10NC00K';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000e1';
const AT = new Date('2026-10-01T00:00:00.000Z');
const FLOUR: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000e101',
    foodId: 'R-flour',
    foodOwnerId: null,
    createdAt: AT,
};
/** The cook's own private food, bound by the line at sort order 1. */
const BLEND: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000e102',
    foodId: 'R-grandma-blend',
    foodOwnerId: COOK,
    createdAt: AT,
};
const ARMS = new Map([FLOUR, BLEND].map((arm) => [arm.lookupId, arm]));
const keypair = generateClerkKeypair();
const savedEnv: Record<string, string | undefined> = {};

/** The line the refusal must name: the private food, at its position in the recipe. */
const REFUSED = { lines: [{ sortOrder: 1, foodId: BLEND.foodId }] };

/** The recipe the double holds for update and set-visibility. */
let stored: RecipeRow;

function aggregateOf(
    recipe: RecipeRow,
    lookups: readonly string[] = [FLOUR.lookupId, BLEND.lookupId],
): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: lookups.map((foodLookupId, sortOrder) =>
            makeIngredientLineRow({ recipeId: recipe.id, foodLookupId, sortOrder, quantity: '1' }),
        ),
    };
}

const create = vi.fn(async (input: { readonly ownerId: string; readonly visibility: RecipeVisibility }) =>
    aggregateOf(makeRecipeRow({ id: RECIPE_ID, ownerId: input.ownerId, visibility: input.visibility })),
);
const update = vi.fn(async () => aggregateOf(stored));
const setVisibility = vi.fn(async (_id: string, visibility: RecipeVisibility) =>
    aggregateOf({ ...stored, visibility }),
);
/** Food, as the caller: the cook's blend is still private, every other food is public. */
const resolve = vi.fn(async (_caller: unknown, refs: readonly { readonly kind: string; readonly id: string }[]) => ({
    answers: new Map(
        refs.map((ref): [string, FoodRefAnswer] => [
            `${ref.kind}:${ref.id}`,
            {
                outcome: 'found',
                name: undefined,
                status: 'RESOLVED',
                isPrivate: ref.id === BLEND.foodId,
                rootId: ref.id,
            },
        ]),
    ),
    degraded: false,
}));

let food: FoodFake;
let booted: BootedServiceApp;

/** One request as the cook, in a signed token. */
async function call(method: string, path: string, body: unknown): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${COOK}`, azp: AZP, externalId: COOK, roles: [] });

    return fetch(`${booted.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** The typed refusal a response carries (parsed with the service's own schema), or a failure naming what came back. */
async function refusalOf(response: Response): Promise<unknown> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

const LINES = [
    { ingredientId: FLOUR.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' },
    { ingredientId: BLEND.lookupId, quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' },
];

const CREATE_BODY = {
    title: 'Spiced bread',
    cuisine: 'Italian',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 30,
    totalTimeMinutes: 35,
    ingredients: LINES,
    steps: [{ instruction: 'Bake.' }],
};

beforeAll(async () => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'RECIPE_DEV_AUTH_USER_ID']) {
        savedEnv[key] = process.env[key];
    }

    delete process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
    food = await startFoodFake();

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    create,
                    update,
                    setVisibility,
                    lockAndCountPrivateSlots: async () => 0,
                    countPrivateSlots: async () => 0,
                    lockSlotFacts: async () => ({ visibility: stored.visibility, status: stored.status }),
                    findById: async (id: string) => (id === stored.id ? aggregateOf(stored) : undefined),
                    // The database's own last check finds nothing: the policy alone must refuse here.
                    privateFoodLines: async () => [],
                    clearPublicFoodOwners: async () => undefined,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ __tx: true }),
                },
            },
            {
                provide: VERSIONS_DAL,
                useValue: {
                    createSnapshot: vi.fn(async () => ({ id: 'v', snapshot: {}, createdAt: AT })),
                    findVersionsBeyondRetention: async () => [],
                },
            },
            { provide: PendingArchivesDal, useValue: { enqueueMany: async () => undefined } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ids.flatMap((id) => (ARMS.has(id) ? [[id, ARMS.get(id)]] : []))),
                },
            },
            { provide: FoodRefsGateway, useValue: { resolve } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
        ],
    });
});

beforeEach(() => {
    stored = makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        visibility: 'public',
        status: 'published',
        cuisine: 'Italian',
        sourceType: 'user_created',
        currentVersion: 1,
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();

    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('POST /api/v1/recipes', () => {
    it('⛔ answers 400 PRIVATE_FOODS_ON_PUBLIC_RECIPE naming the private line, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...CREATE_BODY, visibility: 'public' });

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PRIVATE_FOODS_ON_PUBLIC_RECIPE',
            details: REFUSED,
        });
        expect(create).not.toHaveBeenCalled();
    });

    it('saves the same lines in a private recipe', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...CREATE_BODY, visibility: 'private' });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledOnce();
    });
});

describe('PATCH /api/v1/recipes/{id}', () => {
    it('⛔ answers 400 PRIVATE_FOODS_ON_PUBLIC_RECIPE for replacement lines on a published public recipe', async () => {
        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            ingredients: LINES,
        });

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PRIVATE_FOODS_ON_PUBLIC_RECIPE',
            details: REFUSED,
        });
        expect(update).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id}/visibility', () => {
    it('⛔ answers 400 PRIVATE_FOODS_ON_PUBLIC_RECIPE making a published recipe with a private line public', async () => {
        stored = { ...stored, visibility: 'private' };

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'public' });

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PRIVATE_FOODS_ON_PUBLIC_RECIPE',
            details: REFUSED,
        });
        expect(setVisibility).not.toHaveBeenCalled();
    });
});
