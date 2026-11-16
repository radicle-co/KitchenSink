/**
 * THE STATEMENT RULE (Option B) over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a, DD12):
 * a recipe the cook wrote that has no statement, and whose content was pasted or that has source evidence, may not be left
 * published and Public until the cook says "I wrote this". One block per route; the real `AppModule`, the zod pipe, the auth
 * middleware, `RecipesService`, every policy and the exception filter, with the DALs replaced by STATEFUL doubles (a write by
 * one request is read by the next, which is the whole of the rule).
 *
 * Whether the real database stores and constrains the columns, and whether `recipe_needs_statement` answers what
 * `statementRequiredOf` answers, is the LOCAL e2e tier's (`recipeStatementKind.e2e.test.ts`, `statementRule.e2e.test.ts`).
 */
import { PUBLIC_CONFIRMATION_FOR_API_WRITERS } from '@kitchensink/recipe-core';
import 'reflect-metadata';

import { HttpException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
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
import type { NewRecipeSourceEvidenceRow, RecipeSourceEvidenceRow } from '../../../src/database/schema/index.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import type { Principal } from '../../../src/auth/principal.js';
import { resolveStatementProvenance } from '../../../src/recipes/domain/provenancePolicy.js';
import { createRecipeRequestSchema } from '../../../src/recipes/recipes.schema.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JSTATEMENTRULECOOK00001';
const STRANGER = '01JSTATEMENTRULESTRANGER1';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000f1';
const AT = new Date('2026-11-10T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000f101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const WEB = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

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
        ...(patch.status === undefined ? {} : { status: patch.status }),
        // The data layer's COALESCE(content_pasted_at, now()): set once, never cleared.
        ...(patch.contentPasted === true ? { contentPastedAt: stored.contentPastedAt ?? AT } : {}),
        currentVersion: stored.currentVersion + 1,
    };

    return aggregateOf(stored);
});
const setVisibility = vi.fn(async (_id: string, visibility: RecipeVisibility) => {
    stored = { ...stored, visibility };

    return aggregateOf(stored);
});

let evidence: RecipeSourceEvidenceRow[] = [];
const insertEvidence = vi.fn(async (_tx: unknown, row: NewRecipeSourceEvidenceRow) => {
    evidence.push({
        id: `e-${String(evidence.length + 1)}`,
        sourceUrl: null,
        sourceKey: null,
        sourceDomain: null,
        sourceKind: null,
        citation: null,
        pasteDigest: null,
        creditAuthors: null,
        creditPublisher: null,
        creditCopyrightNotice: null,
        creditCopyrightHolder: null,
        creditLicense: null,
        imageUrl: null,
        recordedAt: AT,
        ...row,
    });
});
const listEvidence = vi.fn(async (recipeId: string, _tx?: unknown) =>
    evidence.filter((row) => row.recipeId === recipeId),
);

/** The row as a concurrent write left it, when a test stages a race: what the row lock reads instead of `stored`. */
let underLock: RecipeRow | undefined;

let food: FoodFake;
let booted: BootedServiceApp;

async function call(method: string, path: string, body: unknown, as: string = COOK): Promise<Response> {
    return asPrincipal(as, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: bearerFor(as) },
            body: method === 'GET' ? undefined : JSON.stringify(body),
        }),
    );
}

/** A PUBLISHED, PUBLIC create body: the shape whose result is the one the rule refuses. */
const PUBLISHED_PUBLIC_BODY = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    cuisine: 'italian',
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Simmer.' }],
    status: 'published',
    visibility: 'public',
    publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
};

async function refusalOf(response: Response): Promise<{ status: number; code: string; details: unknown }> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

const STATEMENT_REQUIRED = { status: 400, code: 'INVALID_VISIBILITY', details: { reason: 'STATEMENT_REQUIRED' } };
const SOURCE_CONFLICT = { status: 400, code: 'INVALID_VISIBILITY', details: { reason: 'SOURCE_CONFLICT' } };

/** A recipe the cook wrote and PASTED into: cook-written on its face, with no statement. */
function pasted(over: Partial<RecipeRow> = {}): RecipeRow {
    return makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        status: 'published',
        visibility: 'private',
        contentPastedAt: AT,
        ...over,
    });
}

function evidenceRow(over: Partial<RecipeSourceEvidenceRow> = {}): RecipeSourceEvidenceRow {
    return {
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
        ...over,
    };
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
                    lockSlotFacts: async () => {
                        const row = underLock ?? stored;

                        return {
                            visibility: row.visibility,
                            status: row.status,
                            sourceType: row.sourceType,
                            sourceKind: row.sourceKind,
                            statementKind: row.statementKind,
                            contentPastedAt: row.contentPastedAt,
                        };
                    },
                    setVisibility,
                    clearPublicFoodOwners: async () => undefined,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ __tx: true }),
                    findNutritionInputs: async () => [],
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
    underLock = undefined;
    evidence = [];
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/recipes — the statement rule on create', () => {
    it('REFUSES a pasted recipe with no statement left published and public: 400 STATEMENT_REQUIRED, nothing written', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLISHED_PUBLIC_BODY, contentPasted: true });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(create).not.toHaveBeenCalled();
    });

    it('ALLOWS the same recipe with "I wrote this", and stores the attestation and the paste fact', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            contentPasted: true,
            statement: AUTHORED,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'user_created',
                sourceKind: null,
                statementKind: 'authored',
                contentPastedAt: expect.any(Date),
                visibility: 'public',
            }),
            expect.anything(),
        );
    });

    it('ALLOWS a recipe typed by hand (no flag) with no statement: it publishes with nothing said', async () => {
        const response = await call('POST', '/api/v1/recipes', PUBLISHED_PUBLIC_BODY);

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ statementKind: null, contentPastedAt: null }),
            expect.anything(),
        );
    });

    it('NEVER refuses Private, whatever was pasted', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            visibility: 'private',
            contentPasted: true,
        });

        expect(response.status).toBe(201);
    });

    it('does not refuse a pasted DRAFT: only its owner can read it', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            status: 'draft',
            contentPasted: true,
        });

        expect(response.status).toBe(201);
    });

    it('accepts only `true` for the flag: a body that says it was NOT pasted is a 400, so it can never un-say it', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLISHED_PUBLIC_BODY, contentPasted: false });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });

    it('answers 400 for "I wrote this" that carries a citation, writing nothing (the wire cannot say it)', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            statement: { kind: 'authored', citation: LINK },
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });

    it('a web statement stores `source` and no paste flag is needed: the web copy is private-only, as before', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            visibility: 'private',
            statement: WEB,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ sourceKind: 'public_web', statementKind: 'source' }),
            expect.anything(),
        );
    });
});

describe('PATCH /api/v1/recipes/{id} — the statement rule on update and publish', () => {
    it('REFUSES to publish a pasted public draft with no statement: 400 STATEMENT_REQUIRED, nothing written', async () => {
        stored = pasted({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(update).not.toHaveBeenCalled();
    });

    it('publishes the same draft when the SAME patch carries "I wrote this"', async () => {
        stored = pasted({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
            statement: AUTHORED,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({ provenance: expect.objectContaining({ statementKind: 'authored' }) }),
            expect.anything(),
        );
        // "I wrote this" states no source, so it never makes the recipe Private.
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('visibility');
    });

    it('REFUSES a PATCH that reports a paste on a recipe ALREADY published and public (the hole a plain edit leaves)', async () => {
        stored = pasted({ visibility: 'public', contentPastedAt: null });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            contentPasted: true,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(update).not.toHaveBeenCalled();
    });

    it('judges the result on the visibility under the ROW LOCK, not the copy read before it', async () => {
        stored = pasted({ visibility: 'private', contentPastedAt: null });
        underLock = { ...stored, visibility: 'public' };

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            contentPasted: true,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(update).not.toHaveBeenCalled();
    });

    it('reads the stored paste fact under the lock: a plain edit of a public published pasted recipe is refused too', async () => {
        stored = pasted({ visibility: 'private', contentPastedAt: null });
        underLock = { ...stored, visibility: 'public', contentPastedAt: AT };

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Soup 2' });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
    });

    it('accepts the flag on a private published recipe and stores it once: a later PATCH without it never clears it', async () => {
        stored = pasted({ contentPastedAt: null });

        const reported = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            contentPasted: true,
        });
        expect(reported.status).toBe(200);
        expect(update).toHaveBeenLastCalledWith(
            RECIPE_ID,
            expect.objectContaining({ contentPasted: true }),
            expect.anything(),
        );
        expect(stored.contentPastedAt).toEqual(AT);

        const edited = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 2, title: 'Soup 2' });
        expect(edited.status).toBe(200);
        expect(update.mock.calls[1]?.[1]).not.toHaveProperty('contentPasted');
        expect(stored.contentPastedAt).toEqual(AT);
    });

    it('answers 400 for `contentPasted: false` on a PATCH', async () => {
        stored = pasted();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            contentPasted: false,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    });

    it('a published PRIVATE pasted recipe takes "I wrote this" AFTER the first publish: 200, and it stays private', async () => {
        stored = pasted();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: AUTHORED,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({ provenance: expect.objectContaining({ statementKind: 'authored' }) }),
            expect.anything(),
        );
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('visibility');
        expect(stored).toMatchObject({ statementKind: 'authored', visibility: 'private' });
    });

    it('says "I wrote this" a second time after the first publish: 200 and nothing written to the source', async () => {
        stored = pasted({ statementKind: 'authored' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: AUTHORED,
            title: 'Soup 2',
        });

        expect(response.status).toBe(200);
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('provenance');
    });

    it('still refuses clearing the statement after the first publish: 403 SOURCE_LOCKED', async () => {
        stored = pasted({ statementKind: 'authored' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(await refusalOf(response)).toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { reason: 'SOURCE_LOCKED' },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('still refuses a web statement after the first publish, even over a recipe with no statement', async () => {
        stored = pasted();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: WEB });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
    });

    it('ORDER: a recipe with evidence AND a missing statement is refused as SOURCE_CONFLICT, not STATEMENT_REQUIRED', async () => {
        stored = pasted({ status: 'draft', visibility: 'public' });
        evidence.push(evidenceRow());

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(response)).toMatchObject(SOURCE_CONFLICT);
    });
});

describe('PATCH /api/v1/recipes/{id}/visibility — the statement rule on set-visibility', () => {
    it('REFUSES Public for a pasted published recipe with no statement: 400 STATEMENT_REQUIRED, nothing written', async () => {
        stored = pasted();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('REFUSES Public for a recipe with evidence of a source that names nothing third-party, and no statement', async () => {
        stored = pasted({ contentPastedAt: null });
        evidence.push(evidenceRow({ sourceDomain: null, sourceKind: null, sourceUrl: null, sourceKey: null }));

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
    });

    it('ALLOWS Public once the cook has said "I wrote this"', async () => {
        stored = pasted({ statementKind: 'authored' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(response.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledOnce();
    });

    it('ALLOWS Public for a recipe typed by hand with no statement', async () => {
        stored = pasted({ contentPastedAt: null });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(response.status).toBe(200);
    });

    it('NEVER refuses Private', async () => {
        stored = pasted({ visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private' });

        expect(response.status).toBe(200);
    });

    it('does not refuse Public for a DRAFT: only its owner can read it', async () => {
        stored = pasted({ status: 'draft' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(response.status).toBe(200);
    });

    it('judges the facts under the row lock: a paste reported after the read still refuses', async () => {
        stored = pasted({ contentPastedAt: null });
        underLock = { ...stored, contentPastedAt: AT };

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(response)).toMatchObject(STATEMENT_REQUIRED);
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('a contained test principal is refused as CONTAINED before the statement is asked about', async () => {
        stored = pasted();
        const containedTester: Principal = {
            userId: COOK,
            sub: `test:${COOK}`,
            scopes: [],
            permissions: [],
            roles: [],
            principalKind: 'test',
            containment: 'enforce',
        };

        const refused = await booted.app
            .get(RecipesService)
            .setVisibility(containedTester, RECIPE_ID, 'public' as RecipeVisibility, undefined)
            .catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(HttpException);
        expect((refused as HttpException).getStatus()).toBe(403);
        expect(JSON.stringify((refused as HttpException).getResponse())).toContain('TEST_PRINCIPAL_CONTAINED');
    });
});

describe('the whole paths a cook walks', () => {
    it('THE CLEAR-THEN-CLAIM PATH IS STILL REFUSED: state a web source, clear it, say "I wrote this", ask for Public: 400 SOURCE_CONFLICT', async () => {
        const created = await call('POST', '/api/v1/recipes', {
            ...PUBLISHED_PUBLIC_BODY,
            status: 'draft',
            visibility: 'private',
            statement: WEB,
        });
        expect(created.status).toBe(201);

        expect(
            (await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null })).status,
        ).toBe(200);
        expect(stored).toMatchObject({ sourceType: 'user_created', sourceKind: null, statementKind: null });

        expect(
            (await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 2, statement: AUTHORED })).status,
        ).toBe(200);
        expect(stored).toMatchObject({ statementKind: 'authored' });

        const asked = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(asked)).toMatchObject(SOURCE_CONFLICT);
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('published private + pasted: PATCH "I wrote this" is 200, then set-visibility Public is 200', async () => {
        stored = pasted();

        expect(
            (await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: AUTHORED })).status,
        ).toBe(200);

        const asked = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(asked.status).toBe(200);
        expect(stored.visibility).toBe('public');
    });

    it('published private + pasted: Public before the statement is 400, after a retry of the statement it is 200', async () => {
        stored = pasted();

        expect(
            await refusalOf(
                await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
                }),
            ),
        ).toMatchObject(STATEMENT_REQUIRED);

        // The recipe page retries the pair: the second "I wrote this" is a no-op, never SOURCE_LOCKED.
        for (const expectedVersion of [1, 2]) {
            expect(
                (await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion, statement: AUTHORED })).status,
            ).toBe(200);
        }

        expect(
            (
                await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
                })
            ).status,
        ).toBe(200);
    });
});

describe('POST /api/v1/recipes/{id}/clone — the statement and the paste fact travel with the recipe', () => {
    it('copies statement_kind and content_pasted_at', async () => {
        stored = pasted({ statementKind: 'authored', visibility: 'public' });

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ statementKind: 'authored', contentPastedAt: AT }),
            expect.anything(),
        );
    });

    it('copies the paste fact of a recipe with no statement, so the clone is asked the same question', async () => {
        stored = pasted({ visibility: 'public' });

        await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ statementKind: null, contentPastedAt: AT }),
            expect.anything(),
        );
    });
});

describe('the bulk import save — the statement kind comes from the per-recipe statement', () => {
    const SYSTEM: Principal = {
        userId: COOK,
        sub: `test:${COOK}`,
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };

    async function saveWith(statement: Parameters<typeof resolveStatementProvenance>[0]): Promise<void> {
        const provenance = resolveStatementProvenance(statement);

        if (provenance === undefined) {
            throw new Error('test setup: the statement must resolve');
        }

        await booted.app
            .get(RecipesService)
            .create(
                SYSTEM,
                createRecipeRequestSchema.parse({ ...PUBLISHED_PUBLIC_BODY, visibility: 'private' }),
                undefined,
                { provenance, lineOrigins: [{ kind: 'cook' }] },
            );
    }

    it.each([
        [{ kind: 'authored' }, 'authored'],
        [{ kind: 'book', citation: 'Joy of Cooking' }, 'source'],
        [{ kind: 'public_web', citation: LINK }, 'source'],
    ] as const)('stores %j as statement_kind %s', async (statement, kind) => {
        await saveWith(statement);

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ statementKind: kind }), expect.anything());
    });
});

describe('the owner-only response — what a stranger must never learn', () => {
    it('tells the OWNER whether Public needs a check or a statement, and what was stated', async () => {
        stored = pasted({ statementKind: null });

        const body = (await (await call('GET', `/api/v1/recipes/${RECIPE_ID}`, undefined)).json()) as Record<
            string,
            unknown
        >;

        expect(body).toMatchObject({ publicNeedsCheck: false, publicNeedsStatement: true });
        expect(body).not.toHaveProperty('statementKind');
        // The paste fact itself is never on the wire.
        expect(JSON.stringify(body)).not.toMatch(/contentPasted/u);
    });

    it('reports a source conflict to the owner, and the stored statement once there is one', async () => {
        stored = pasted({ statementKind: 'authored' });
        evidence.push(evidenceRow());

        const body = (await (await call('GET', `/api/v1/recipes/${RECIPE_ID}`, undefined)).json()) as Record<
            string,
            unknown
        >;

        expect(body).toMatchObject({ statementKind: 'authored', publicNeedsCheck: true, publicNeedsStatement: false });
    });

    it('OMITS all three from a stranger reading the same public recipe', async () => {
        stored = pasted({ visibility: 'public', statementKind: 'authored' });
        evidence.push(evidenceRow());

        const body = (await (await call('GET', `/api/v1/recipes/${RECIPE_ID}`, undefined, STRANGER)).json()) as Record<
            string,
            unknown
        >;

        expect(body).toMatchObject({ id: RECIPE_ID });
        expect(body).not.toHaveProperty('statementKind');
        expect(body).not.toHaveProperty('publicNeedsCheck');
        expect(body).not.toHaveProperty('publicNeedsStatement');
    });

    it('carries the fields on the owner’s write responses too (create, update, set-visibility)', async () => {
        const created = (await (
            await call('POST', '/api/v1/recipes', {
                ...PUBLISHED_PUBLIC_BODY,
                visibility: 'private',
                contentPasted: true,
            })
        ).json()) as Record<string, unknown>;
        expect(created).toMatchObject({ publicNeedsStatement: true, publicNeedsCheck: false });

        const updated = (await (
            await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: AUTHORED })
        ).json()) as Record<string, unknown>;
        expect(updated).toMatchObject({ statementKind: 'authored', publicNeedsStatement: false });

        const made = (await (
            await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
            })
        ).json()) as Record<string, unknown>;
        expect(made).toMatchObject({ statementKind: 'authored', publicNeedsStatement: false });
    });
});
