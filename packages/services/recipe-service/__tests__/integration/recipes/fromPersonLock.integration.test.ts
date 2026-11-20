/**
 * P7 (fromPersonLock, owner ruling 2026-11-19): once a recipe stores "From another person", no cook write changes or clears
 * it, through the editor save (PATCH), a publish request (PATCH with a status) or the "Make public" sheet (set-visibility).
 * Over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` section 7.1a): the real policy, service
 * and gate, with the DALs as doubles.
 *
 * Two states are locked: a STORED statement, and the R2 state (no stored statement, a past "from another person"
 * attestation). The attestation fact is read through the attestations double, so each R2 case asserts the double's ARGUMENTS
 * (the write's transaction and the recipe id): a stub that returned `true` for any call would pass otherwise. The R4 cases set
 * the double to `false` explicitly. That the REAL read answers correctly is the LOCAL e2e tier's (`statementClearedGate`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import {
    makeIngredientLineRow,
    makeRecipeRow,
    makeRecipeStepRow,
    PUBLIC_CONFIRMATION_AS_SHOWN,
} from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { RecipeAggregate, UpdateRecipeInput } from '../../../src/recipes/dal/recipes.dal.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import { RecipeStatementAttestationsDal } from '../../../src/recipes/dal/recipeStatementAttestations.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JFROMPERSONLOCKCOOK0001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000f7';
const AT = new Date('2026-11-20T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000f701',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const TX = { __tx: true };

const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const FROM_PERSON = { kind: 'fromPerson', wording: { version: 'statementFromPerson.v1', locale: 'en' } } as const;

let stored: RecipeRow;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const create = vi.fn(async (input: Partial<RecipeRow>, _tx?: unknown) => {
    stored = makeRecipeRow({ ...input, id: RECIPE_ID, ownerId: COOK });

    return aggregateOf(stored);
});
const update = vi.fn(async (_id: string, patch: UpdateRecipeInput, _tx?: unknown) => {
    stored = {
        ...stored,
        ...(patch.provenance === undefined ? {} : patch.provenance),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
        currentVersion: stored.currentVersion + 1,
    };

    return aggregateOf(stored);
});
const setVisibility = vi.fn(async (_id: string, visibility: RecipeRow['visibility']) =>
    aggregateOf({ ...stored, visibility }),
);
const insertEvidence = vi.fn(async () => undefined);
const insertMany = vi.fn(async () => undefined);
const hasFromPerson = vi.fn(async (_tx: unknown, _recipeId: string) => false);

let food: FoodFake;
let booted: BootedServiceApp;

async function call(method: string, path: string, body: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify(body),
        }),
    );
}

async function refusalOf(response: Response): Promise<{ status: number; details: unknown }> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, details: 'details' in parsed ? parsed.details : undefined };
}

beforeAll(async () => {
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
                    findById: async (id: string) => (id === RECIPE_ID ? aggregateOf(stored) : undefined),
                    privateFoodLines: async () => [],
                    lockAndCountPrivateSlots: async () => 0,
                    lockSlotFacts: async () => ({
                        visibility: stored.visibility,
                        status: stored.status,
                        sourceType: stored.sourceType,
                        sourceKind: stored.sourceKind,
                        statementKind: stored.statementKind,
                        contentPastedAt: stored.contentPastedAt,
                        clonedFromId: stored.clonedFromId,
                        sourceAttribution: stored.sourceAttribution,
                    }),
                    setVisibility,
                    clearPublicFoodOwners: async () => undefined,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(TX),
                },
            },
            { provide: RecipeSourceEvidenceDal, useValue: { insert: insertEvidence, list: async () => [] } },
            { provide: RecipeStatementAttestationsDal, useValue: { insertMany, hasFromPerson } },
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

afterEach(() => {
    vi.clearAllMocks();
    hasFromPerson.mockImplementation(async () => false);
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

const FROM_PERSON_ROW = { statementKind: 'fromPerson' } as const;
const R2_ROW = { statementKind: null } as const;

/** The three routes that write a statement, each sending the same statement. */
const ROUTES = [
    {
        name: 'the editor save (PATCH)',
        send: (statement: unknown) => call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement }),
        status: 'draft',
    },
    {
        name: 'a publish request (PATCH with a status)',
        send: (statement: unknown) =>
            call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, status: 'published', statement }),
        status: 'draft',
    },
    {
        name: 'the Make public sheet (set-visibility)',
        send: (statement: unknown) =>
            call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                statement,
            }),
        status: 'published',
    },
] as const;

function expectNothingWritten(): void {
    expect(update).not.toHaveBeenCalled();
    expect(setVisibility).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
}

describe('AE10: "I wrote this" over a stored "From another person" is refused on every route', () => {
    it.each(ROUTES)('$name: 403 SOURCE_LOCKED, nothing written, the recipe stays private', async (route) => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: route.status,
            visibility: 'private',
            cuisine: 'italian',
            ...FROM_PERSON_ROW,
        });

        const response = await route.send(AUTHORED);

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expectNothingWritten();
        expect(stored).toMatchObject({ visibility: 'private', statementKind: 'fromPerson' });
        // A stored statement answers the question itself: the attestation is not read.
        expect(hasFromPerson).not.toHaveBeenCalled();
    });
});

describe('AE10, R2: "I wrote this" over a past "From another person" attestation with no stored statement is refused', () => {
    it.each(ROUTES)('$name: 403 SOURCE_LOCKED, the attestation is read in the write’s transaction', async (route) => {
        hasFromPerson.mockImplementation(async () => true);
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: route.status,
            visibility: 'private',
            cuisine: 'italian',
            ...R2_ROW,
        });

        const response = await route.send(AUTHORED);

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expectNothingWritten();
        expect(stored).toMatchObject({ visibility: 'private', statementKind: null });
        expect(hasFromPerson).toHaveBeenCalledWith(TX, RECIPE_ID);
    });

    it.each(ROUTES)('$name: stating "From another person" again still applies and stays private', async (route) => {
        hasFromPerson.mockImplementation(async () => true);
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: route.status,
            visibility: 'private',
            cuisine: 'italian',
            ...R2_ROW,
        });

        await route.send(FROM_PERSON);

        // Whatever the route then says about Public, the answer was not refused as locked, and nothing made it public.
        expect(stored.visibility).toBe('private');
        expect(hasFromPerson).toHaveBeenCalledWith(TX, RECIPE_ID);
    });
});

describe('R3: "From another person" over itself is a no-op, not a refusal', () => {
    it('the editor save answers 200 and writes no statement and no evidence', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            ...FROM_PERSON_ROW,
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: FROM_PERSON,
        });

        expect(response.status).toBe(200);
        expect(insertEvidence).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
        expect(stored.statementKind).toBe('fromPerson');
    });
});

describe('R4: an unstated recipe is not locked', () => {
    it.each([
        ['"I wrote this"', AUTHORED, 'authored'],
        ['"From another person"', FROM_PERSON, 'fromPerson'],
    ] as const)('answered %s applies (200)', async (_name, statement, kind) => {
        hasFromPerson.mockImplementation(async () => false);
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            statementKind: null,
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement });

        expect(response.status).toBe(200);
        expect(stored.statementKind).toBe(kind);
        expect(hasFromPerson).toHaveBeenCalledWith(TX, RECIPE_ID);
    });
});

describe('AE9: the cook’s own clone of a "From another person" recipe holds the answer, and it stays locked', () => {
    it('the clone lands private, and "I wrote this" over it is 403 SOURCE_LOCKED', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            ...FROM_PERSON_ROW,
        });

        const cloned = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(cloned.status).toBe(201);
        expect(stored).toMatchObject({ visibility: 'private', statementKind: 'fromPerson' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: AUTHORED,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
        expect(stored).toMatchObject({ visibility: 'private', statementKind: 'fromPerson' });
    });
});
