/**
 * Private slots (ADR-0073) over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a):
 * the real `AppModule` - Nest's router, the zod pipes, the auth middleware verifying a SIGNED token (so Premium is read
 * from signed roles, not a dev bypass), `RecipesService`, the visibility and slot policies, the exception filter - with the
 * recipe DAL replaced by a double whose live private count the test sets.
 *
 * REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073 section 12): a draft holds no slot. The clone case used to expect
 * a 403 at 50; a clone is a draft, so it is now a 201 and the refusal moved to publishing a private draft (`PATCH`).
 *
 * It pins what the unit tier cannot: that the refusal reaches the wire as the published `403 PRIVATE_SLOTS_FULL` envelope
 * (parsed with the service's own typed error schema, so a body short of `used` and `limit` fails here), on create,
 * set-visibility and publishing a private draft; that a private draft and a clone never reach the count; that Premium never reaches the count; and that `GET /api/v1/recipes/private-slots` is routed to
 * its own handler and not swallowed by `GET :id` (which would answer a UUID-parse 400).
 *
 * Whether the lock really excludes a second connection, and whether the count is the right rows, are the LOCAL e2e tier's
 * (`tests/e2e/recipes/privateSlots.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
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
import type { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

const AZP = 'https://recipes.example.com';
const FREE_COOK = '01JSLOTSINTEGRATIONFREE001';
const PREMIUM_COOK = '01JSLOTSINTEGRATIONPREM001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000f1';
const AT = new Date('2026-10-01T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000f101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const keypair = generateClerkKeypair();
const savedEnv: Record<string, string | undefined> = {};

/** The cook's live private count, which the DAL double reports under the lock and for the display read. */
let held = 0;
/** The recipe the double holds for set-visibility and clone. */
let stored: RecipeRow;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const create = vi.fn(
    async (input: {
        readonly ownerId: string;
        readonly visibility: RecipeVisibility;
        readonly status?: RecipeStatus;
    }) =>
        aggregateOf(
            makeRecipeRow({
                id: RECIPE_ID,
                ownerId: input.ownerId,
                visibility: input.visibility,
                status: input.status ?? 'published',
            }),
        ),
);
const update = vi.fn(async () => aggregateOf({ ...stored, status: 'published' } as RecipeRow));
const setVisibility = vi.fn(async (_id: string, visibility: RecipeVisibility) =>
    aggregateOf({ ...stored, visibility } as RecipeRow),
);
const lockAndCountPrivateSlots = vi.fn(async (_tx: unknown, _owner: string) => held);
const countPrivateSlots = vi.fn(async (_owner: string) => held);

let food: FoodFake;
let booted: BootedServiceApp;

/** One request as `owner`, holding `roles` in a signed token. */
async function call(
    owner: string,
    roles: readonly string[],
    method: string,
    path: string,
    body?: unknown,
): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${owner}`, azp: AZP, externalId: owner, roles });

    return fetch(`${booted.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

const CREATE_BODY = {
    title: 'Pesto',
    cuisine: 'Italian',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 0,
    totalTimeMinutes: 5,
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Blend.' }],
};

/** The typed refusal a response carries (parsed with the service's own schema), or a failure naming what came back. */
async function refusalOf(response: Response): Promise<unknown> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

beforeAll(async () => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'RECIPE_DEV_AUTH_USER_ID']) {
        savedEnv[key] = process.env[key];
    }

    delete process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
    food = await startFoodFake();
    food.foods.set('R-basil', { name: 'Basil', status: 'RESOLVED', caloriesPer100g: 23 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    create,
                    update,
                    setVisibility,
                    lockAndCountPrivateSlots,
                    countPrivateSlots,
                    lockSlotFacts: async () => ({
                        visibility: stored.visibility,
                        status: stored.status,
                        sourceType: stored.sourceType,
                        sourceKind: stored.sourceKind,
                    }),
                    findById: async (id: string) => (id === stored.id ? aggregateOf(stored) : undefined),
                    // ADR-0029 section 4: the database holds no private food in these suites.
                    privateFoodLines: async () => [],
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
                        new Map(ids.includes(BASIL.lookupId) ? [[BASIL.lookupId, BASIL]] : []),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
        ],
    });
});

beforeEach(() => {
    held = 0;
    stored = makeRecipeRow({ id: RECIPE_ID, ownerId: FREE_COOK, visibility: 'public', sourceType: 'user_created' });
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

describe('POST /api/v1/recipes with visibility private', () => {
    it('⛔ answers 403 PRIVATE_SLOTS_FULL with used and limit (not a 409) for a free cook at the limit, and writes nothing', async () => {
        held = 50;

        const response = await call(FREE_COOK, ['default'], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
        });

        expect(await refusalOf(response)).toEqual({
            status: 403,
            code: 'PRIVATE_SLOTS_FULL',
            details: { used: 50, limit: 50 },
        });
        expect(create).not.toHaveBeenCalled();
    });

    it('allows the 50th: a free cook holding 49 creates one, counted under the lock for THAT cook', async () => {
        held = 49;

        const response = await call(FREE_COOK, ['default'], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
        });

        expect(response.status).toBe(201);
        expect(lockAndCountPrivateSlots).toHaveBeenCalledWith({ __tx: true }, FREE_COOK);
        expect(create).toHaveBeenCalledOnce();
    });

    it('a downgraded cook holding 60 is told 60 of 50', async () => {
        held = 60;

        const response = await call(FREE_COOK, [], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { used: 60, limit: 50 } });
    });

    it('⛔ Premium (a signed role) is never counted, however many it holds', async () => {
        held = 5_000;

        const response = await call(PREMIUM_COOK, ['premium'], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
        });

        expect(response.status).toBe(201);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it.each([50, 60])('⛔ a private DRAFT is saved at %i: 201, never counted, never refused', async (count) => {
        held = count;

        const response = await call(FREE_COOK, ['default'], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
            status: 'draft',
        });

        expect(response.status).toBe(201);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private', status: 'draft' }), {
            __tx: true,
        });
    });

    it('a PUBLIC create is never counted', async () => {
        held = 60;

        const response = await call(FREE_COOK, ['default'], 'POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'public',
        });

        expect(response.status).toBe(201);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id}/visibility', () => {
    it('⛔ answers 403 PRIVATE_SLOTS_FULL for a free cook at the limit, and writes nothing', async () => {
        held = 50;

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
        });

        expect(await refusalOf(response)).toEqual({
            status: 403,
            code: 'PRIVATE_SLOTS_FULL',
            details: { used: 50, limit: 50 },
        });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('asking for private on a recipe ALREADY private is a success at 60: it holds its own slot', async () => {
        held = 60;
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: FREE_COOK,
            visibility: 'private',
            sourceType: 'user_created',
        });

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
        });

        expect(response.status).toBe(200);
    });

    // REWRITTEN for ADR-0077 section 6: it was refused 400 INVALID_VISIBILITY for want of Premium, with slots to spare.
    // It is a slot like any other label now, so a free slot lets it go private and the count is taken.
    it('an imported public-web recipe goes private in a free slot, and is counted (ADR-0077 section 6)', async () => {
        held = 0;
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: FREE_COOK,
            visibility: 'public',
            sourceType: 'imported_public',
        });

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
        });

        expect(response.status).toBe(200);
        expect(lockAndCountPrivateSlots).toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id} - publishing a private draft takes a slot', () => {
    function storeDraft(visibility: 'private' | 'public'): void {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: FREE_COOK,
            visibility,
            status: 'draft',
            cuisine: 'Italian',
            sourceType: 'user_created',
            currentVersion: 1,
        });
    }

    it('⛔ answers 403 PRIVATE_SLOTS_FULL with used and limit for a free cook at the limit, and writes nothing', async () => {
        held = 50;
        storeDraft('private');

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toEqual({
            status: 403,
            code: 'PRIVATE_SLOTS_FULL',
            details: { used: 50, limit: 50 },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('publishes the private draft with a slot free (49), counted under the lock for THAT cook', async () => {
        held = 49;
        storeDraft('private');

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(response.status).toBe(200);
        expect(lockAndCountPrivateSlots).toHaveBeenCalledWith({ __tx: true }, FREE_COOK);
    });

    it('saving the private draft as a draft at 50 is a success and is never counted', async () => {
        held = 50;
        storeDraft('private');

        const response = await call(FREE_COOK, ['default'], 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            title: 'Still a draft',
        });

        expect(response.status).toBe(200);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });
});

describe('POST /api/v1/recipes/{id}/clone', () => {
    it('⛔ a free cook at the limit CAN clone their own private book recipe: the copy is a draft and uses no slot', async () => {
        held = 50;
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: FREE_COOK,
            visibility: 'private',
            sourceType: 'imported_physical',
        });

        const response = await call(FREE_COOK, ['default'], 'POST', `/api/v1/recipes/${RECIPE_ID}/clone`);

        expect(response.status).toBe(201);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }), { __tx: true });
    });
});

describe('GET /api/v1/recipes/private-slots', () => {
    it('is routed to its own handler, not swallowed by GET :id, and states the count and the limit', async () => {
        held = 12;

        const response = await call(FREE_COOK, ['default'], 'GET', '/api/v1/recipes/private-slots');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ kind: 'limited', used: 12, limit: 50 });
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('answers unlimited for Premium, without counting', async () => {
        const response = await call(PREMIUM_COOK, ['premium'], 'GET', '/api/v1/recipes/private-slots');

        expect(await response.json()).toEqual({ kind: 'unlimited' });
        expect(countPrivateSlots).not.toHaveBeenCalled();
    });

    it('needs a signed-in cook', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipes/private-slots`);

        expect(response.status).toBe(401);
    });
});
