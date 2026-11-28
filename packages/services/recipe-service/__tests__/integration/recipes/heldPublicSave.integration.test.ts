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
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { RecipeAggregate, UpdateRecipeInput } from '../../../src/recipes/dal/recipes.dal.js';
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

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const update = vi.fn(async (_id: string, patch: UpdateRecipeInput, _tx?: unknown) => {
    stored = {
        ...stored,
        ...(patch.provenance === undefined ? {} : patch.provenance),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
        currentVersion: stored.currentVersion + 1,
    };

    return aggregateOf(stored);
});

/** `listEvidence` feeds the gate the seeded rows; `insertEvidence` exists to prove nothing is appended. */
let evidence: RecipeSourceEvidenceRow[] = [];
const insertEvidence = vi.fn();
const listEvidence = vi.fn(async (recipeId: string, _tx?: unknown) =>
    evidence.filter((row) => row.recipeId === recipeId),
);

const setVisibility = vi.fn(async (_id: string, visibility: RecipeVisibility) =>
    aggregateOf({ ...stored, visibility }),
);

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
                    findById: async (id: string) => (id === RECIPE_ID ? aggregateOf(stored) : undefined),
                    privateFoodLines: async () => [],
                    lockAndCountPrivateSlots: async () => 0,
                    lockSlotFacts: async () => {
                        const row = stored;

                        return {
                            visibility: row.visibility,
                            status: row.status,
                            sourceType: row.sourceType,
                            sourceKind: row.sourceKind,
                            sourceUrl: row.sourceUrl,
                            sourceConfirmedAt: row.sourceConfirmedAt,
                            sourceCorrectionHold: row.sourceCorrectionHold,
                            statementKind: row.statementKind,
                            contentPastedAt: row.contentPastedAt,
                            clonedFromId: row.clonedFromId,
                            sourceAttribution: row.sourceAttribution,
                        };
                    },
                    setVisibility,
                    clearPublicFoodOwners: async () => undefined,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ __tx: true }),
                },
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
    evidence = [];
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
