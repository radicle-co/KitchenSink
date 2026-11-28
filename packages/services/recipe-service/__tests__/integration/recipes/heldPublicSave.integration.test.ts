/**
 * P10a, U1 (heldPublicSave): the characterization of today's refusal. A HELD published public recipe is a published,
 * public, `user_created` row with `source_confirmed_at` set and one web evidence row. Saving an edit of it over the real
 * pipeline (mocked DALs) is refused `400 INVALID_VISIBILITY` with `details.reason: 'SOURCE_CONFLICT'`, and the DAL
 * `update` is never called, so nothing is written. This is the behaviour the toggle-OFF path must keep (KTD-5); it must be
 * green on main before any production change and again at each later head.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import {
    makeIngredientLineRow,
    makeRecipeRow,
    makeRecipeStepRow,
    PUBLIC_CONFIRMATION_AS_SHOWN,
} from '../../../src/__fixtures__/index.js';
import { FAKE_TX } from '../../../src/recipes/__fixtures__/recipesDal.fixture.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { RecipeAggregate, RecipesDal, UpdateRecipeInput } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import type { RecipeSourceEvidenceRow } from '../../../src/database/schema/index.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { lockedFactsOf } from '../../../tests/support/lockedRecipeFacts.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JSOURCESTATEMENTCOOK0001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000e1';
const AT = new Date('2026-11-10T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000e101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};

/** The recipe the double holds. Each test sets it. */
let stored: RecipeRow;

/** The live private count the slot lock reports. Reset after each test. */
let slotsUsed = 0;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const update = vi.fn((_id: string, patch: UpdateRecipeInput) => {
    stored = {
        ...stored,
        ...(patch.provenance === undefined ? {} : patch.provenance),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
        currentVersion: stored.currentVersion + 1,
    };

    return Promise.resolve(aggregateOf(stored));
});

/** `listEvidence` feeds the gate the seeded rows; `insertEvidence` exists to prove nothing is appended. */
let evidence: RecipeSourceEvidenceRow[] = [];
const insertEvidence = vi.fn();
const listEvidence = vi.fn((recipeId: string) => Promise.resolve(evidence.filter((row) => row.recipeId === recipeId)));

const setVisibility = vi.fn((_id: string, visibility: RecipeVisibility) =>
    Promise.resolve(aggregateOf({ ...stored, visibility })),
);

let food: FoodFake | undefined;
let booted: BootedServiceApp | undefined;

async function call(method: string, path: string, body: unknown): Promise<Response> {
    if (booted === undefined) {
        throw new Error('test setup: the app did not boot');
    }

    const { baseUrl } = booted;

    return asPrincipal(COOK, () =>
        fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify(body),
        }),
    );
}

/** The typed refusal a response carries. */
async function refusalOf(response: Response): Promise<{ status: number; code: string; details: unknown }> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
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
                    update,
                    findById: (id: string) => Promise.resolve(id === RECIPE_ID ? aggregateOf(stored) : undefined),
                    privateFoodLines: () => Promise.resolve([]),
                    lockAndCountPrivateSlots: () => Promise.resolve(slotsUsed),
                    lockSlotFacts: () => Promise.resolve(lockedFactsOf(stored)),
                    setVisibility,
                    clearPublicFoodOwners: () => Promise.resolve(undefined),
                    transaction: (work) => work(FAKE_TX),
                } satisfies Partial<RecipesDal>,
            },
            {
                provide: RecipeSourceEvidenceDal,
                useValue: {
                    insert: insertEvidence,
                    list: listEvidence,
                },
            },
            {
                provide: VERSIONS_DAL,
                useValue: {
                    createSnapshot: vi.fn(() => Promise.resolve({ id: 'v', snapshot: {}, createdAt: AT })),
                    findVersionsBeyondRetention: () => Promise.resolve([]),
                },
            },
            { provide: PendingArchivesDal, useValue: { enqueueMany: () => Promise.resolve(undefined) } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: () => Promise.resolve([]) } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: () => Promise.resolve(undefined) } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: {
                    findBandsByKeys: () => Promise.resolve(new Map()),
                    findExistingKeys: () => Promise.resolve(new Set()),
                },
            },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: (ids: readonly string[]) =>
                        Promise.resolve(new Map(ids.includes(BASIL.lookupId) ? [[BASIL.lookupId, BASIL]] : [])),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: () => Promise.resolve(undefined) } },
            { provide: AuthorHandlesDal, useValue: { findByline: () => Promise.resolve(undefined) } },
        ],
    });
});

afterEach(() => {
    evidence = [];
    slotsUsed = 0;
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

const LINK = 'https://www.allrecipes.com/recipe/1/soup/';

/** A held row: published, public, cook-written on its face, source confirmed at first publish, web evidence behind it. */
function heldRow(): RecipeRow {
    return makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        status: 'published',
        visibility: 'public',
        sourceType: 'user_created',
        sourceKind: null,
        sourceConfirmedAt: AT,
        firstPublishedAt: AT,
    });
}

function webEvidence(): void {
    evidence.push({
        id: 'e-0',
        recipeId: RECIPE_ID,
        capture: 'editorLink',
        sourceUrl: LINK,
        sourceKey: LINK,
        sourceDomain: 'allrecipes.com',
        sourceKind: 'public_web',
        citation: null,
        pasteDigest: null,
        creditAuthors: null,
        creditPublisher: null,
        creditCopyrightNotice: null,
        creditCopyrightHolder: null,
        creditLicense: null,
        imageUrl: null,
        recordedAt: AT,
    });
}

describe('PATCH /api/v1/recipes/{id} — a held published public recipe (today, before heldPublicSave)', () => {
    it('refuses a title edit with 400 INVALID_VISIBILITY / SOURCE_CONFLICT and writes nothing', async () => {
        stored = heldRow();
        webEvidence();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: stored.currentVersion,
            title: 'A new title',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            code: 'INVALID_VISIBILITY',
            details: { reason: 'SOURCE_CONFLICT' },
        });
        expect(update).not.toHaveBeenCalled();
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertEvidence).not.toHaveBeenCalled();
    });

    it('CONTROL: the same edit of the same row with NO evidence is saved', async () => {
        stored = heldRow();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: stored.currentVersion,
            title: 'A new title',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledOnce();
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({ title: 'A new title' }),
            expect.anything(),
        );
    });
});

/**
 * heldPublicSave U8 (AE3, AE9): `heldSave: 'private'` saves the edit AND makes the recipe private in ONE write, over the real
 * pipeline (mocked DALs). The slot lock is taken first, so a free cook gets 200 and not the fail-closed 500 (redteam R1);
 * it is honoured for any owned published public recipe, held or not (R3); a full slot answers 403 and writes nothing.
 */
describe('PATCH /api/v1/recipes/{id} with heldSave "private" (heldPublicSave U8)', () => {
    const patch = (over: Record<string, unknown> = {}) => ({
        expectedVersion: stored.currentVersion,
        title: 'A new title',
        heldSave: 'private',
        ...over,
    });

    it('a held row with a free slot: 200, content saved, private, version bumped, no evidence appended', async () => {
        stored = heldRow();
        webEvidence();
        slotsUsed = 10;
        const version = stored.currentVersion;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch());

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({ title: 'A new title', visibility: 'private' }),
            expect.anything(),
        );
        expect(stored).toMatchObject({ visibility: 'private', currentVersion: version + 1 });
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertEvidence).not.toHaveBeenCalled();
    });

    it('an UNHELD public row (the hold cleared before the drain) is made private too', async () => {
        stored = heldRow();
        slotsUsed = 10;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch());

        expect(response.status).toBe(200);
        expect(stored.visibility).toBe('private');
    });

    it.each([
        [49, 200],
        [50, 403],
    ])('at %i private recipes the answer is %i (the 49/50 pair)', async (used, status) => {
        stored = heldRow();
        webEvidence();
        slotsUsed = used;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch());

        expect(response.status).toBe(status);

        if (status === 200) {
            expect(update).toHaveBeenCalledWith(
                RECIPE_ID,
                expect.objectContaining({ visibility: 'private' }),
                expect.anything(),
            );
            expect(stored.visibility).toBe('private');
        }

        if (status === 403) {
            expect(await refusalOf(response)).toMatchObject({ status: 403, code: 'PRIVATE_SLOTS_FULL' });
            expect(update).not.toHaveBeenCalled();
            expect(stored.visibility).toBe('public');
        }
    });

    it('a DRAFT with heldSave answers as if the field were absent: no visibility in the write', async () => {
        stored = { ...heldRow(), status: 'draft' };
        slotsUsed = 10;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch());

        expect(response.status).toBe(200);
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('visibility');
    });

    it('a held public DRAFT sent as a publish with heldSave answers 400 SOURCE_CONFLICT and writes nothing (S9)', async () => {
        stored = { ...heldRow(), status: 'draft' };
        webEvidence();
        slotsUsed = 10;

        const response = await call(
            'PATCH',
            `/api/v1/recipes/${RECIPE_ID}`,
            patch({ status: 'published', publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN }),
        );

        expect(await refusalOf(response)).toMatchObject({ status: 400, details: { reason: 'SOURCE_CONFLICT' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('"hide" is refused today as the held row it is: 400 SOURCE_CONFLICT, nothing written', async () => {
        stored = heldRow();
        webEvidence();
        slotsUsed = 10;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch({ heldSave: 'hide' }));

        expect(await refusalOf(response)).toMatchObject({ status: 400, details: { reason: 'SOURCE_CONFLICT' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('an unknown heldSave value is a 400 validation error', async () => {
        stored = heldRow();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, patch({ heldSave: 'public' }));

        expect(response.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
    });
});
