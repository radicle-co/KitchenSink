/**
 * THE ATTESTATION RECORD over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a, DD12):
 * every statement a cook makes and every Public confirmation is one row in `recipe_statement_attestations`, written by the
 * service in the SAME transaction as the write it records, after the write landed. One block per route; the real
 * `AppModule`, the zod pipe, the auth middleware, `RecipesService`, every policy and the exception filter, with the DALs
 * replaced by STATEFUL doubles.
 *
 * What a mocked database CANNOT prove, and the LOCAL e2e tier does (`statementAttestations.e2e.test.ts`): that a refusal or a
 * rollback leaves no row, that the table is append-only and that the constraints hold. Here the proof is the call itself: the
 * rows are handed to the DAL with the write's own transaction, after the write's own call, and never on a refusal.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PUBLIC_CONFIRMATION_FOR_API_WRITERS, type RecipeVisibility } from '@kitchensink/recipe-core';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import type {
    NewRecipeSourceEvidenceRow,
    RecipeRow,
    RecipeSourceEvidenceRow,
} from '../../../src/database/schema/index.js';
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

const COOK = '01JATTESTATIONCOOK000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000a1';
const AT = new Date('2026-11-10T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000a101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const TX = { __tx: true };

const CONFIRM = PUBLIC_CONFIRMATION_FOR_API_WRITERS;
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const WEB = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking, p. 12',
    wording: { version: 'statementBook.v1', locale: 'en' },
} as const;
const PERSON = { kind: 'fromPerson', wording: { version: 'statementFromPerson.v1', locale: 'en' } } as const;

const CONFIRM_ROW = (action: string) => ({
    recipeId: RECIPE_ID,
    accountId: COOK,
    mode: 'implicit',
    choice: 'publicConfirm',
    wordingVersion: 'publicConfirm.v1',
    locale: 'en',
    action,
});
const STATEMENT_ROW = (choice: string, version: string, action: string) => ({
    recipeId: RECIPE_ID,
    accountId: COOK,
    mode: 'explicit',
    choice,
    wordingVersion: version,
    locale: 'en',
    action,
});

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
        currentVersion: stored.currentVersion + 1,
    };

    return aggregateOf(stored);
});
const setVisibility = vi.fn(
    async (_id: string, visibility: RecipeVisibility, _tx?: unknown, provenance?: UpdateRecipeInput['provenance']) => {
        stored = { ...stored, ...(provenance === undefined ? {} : provenance), visibility };

        return aggregateOf(stored);
    },
);
const insertMany = vi.fn(async (_tx: unknown, _rows: readonly unknown[]) => undefined);

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

/** Set when a test makes the row vanish between the read and the write (a concurrent tombstone). */
let writeFindsNoRow = false;

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

const CREATE_BODY = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    cuisine: 'italian',
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Simmer.' }],
};
const PUBLIC_PUBLISHED = { ...CREATE_BODY, status: 'published', visibility: 'public' };

async function refusalOf(response: Response): Promise<{ status: number; code: string; details: unknown }> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

const CONFIRMATION_REQUIRED = {
    status: 400,
    code: 'INVALID_VISIBILITY',
    details: { reason: 'PUBLIC_CONFIRMATION_REQUIRED' },
};

function rowOf(over: Partial<RecipeRow> = {}): RecipeRow {
    return makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        status: 'published',
        visibility: 'private',
        statementKind: null,
        contentPastedAt: null,
        ...over,
    });
}

/** The rows the DAL was handed, flattened across calls, so a test says only what was recorded. */
function recorded(): unknown[] {
    return insertMany.mock.calls.flatMap((args) => [...args[1]]);
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
                    update: async (id: string, patch: UpdateRecipeInput, tx?: unknown) =>
                        writeFindsNoRow ? undefined : update(id, patch, tx),
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
                        firstPublishedAt: stored.firstPublishedAt,
                        clonedFromId: stored.clonedFromId,
                    }),
                    setVisibility: async (
                        id: string,
                        visibility: RecipeVisibility,
                        tx?: unknown,
                        provenance?: UpdateRecipeInput['provenance'],
                    ) => (writeFindsNoRow ? undefined : setVisibility(id, visibility, tx, provenance)),
                    clearPublicFoodOwners: async () => undefined,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(TX),
                    findNutritionInputs: async () => [],
                    readConflict: async () => ({ current: aggregateOf(stored) }),
                },
            },
            { provide: RecipeStatementAttestationsDal, useValue: { insertMany } },
            {
                provide: RecipeSourceEvidenceDal,
                useValue: {
                    insert: insertEvidence,
                    listForRecipe: async (_tx: unknown, recipeId: string) =>
                        evidence.filter((row) => row.recipeId === recipeId),
                    listCommitted: async (recipeId: string) => evidence.filter((row) => row.recipeId === recipeId),
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
    writeFindsNoRow = false;
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('the wire: a statement names the wording the cook saw', () => {
    it.each([
        ['an unknown wording version', { ...AUTHORED, wording: { version: 'statementAuthored.v9', locale: 'en' } }],
        [
            'a wording that belongs to another choice',
            { ...AUTHORED, wording: { version: 'statementBook.v1', locale: 'en' } },
        ],
        ['a statement with no wording', { kind: 'authored' }],
        ['a locale of one character', { ...AUTHORED, wording: { version: 'statementAuthored.v1', locale: 'e' } }],
        ['a book with no citation', { kind: 'book', wording: BOOK.wording }],
        ['a book with a blank citation', { ...BOOK, citation: '   ' }],
        ['another person’s recipe that carries a citation', { ...PERSON, citation: 'Aunt May' }],
    ])('answers 400 for %s, writing nothing', async (_name, statement) => {
        const response = await call('POST', '/api/v1/recipes', { ...CREATE_BODY, visibility: 'private', statement });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('answers 400 for a confirmation with an unknown wording, on every route', async () => {
        stored = rowOf();
        const bad = { version: 'publicConfirm.v9', locale: 'en' };

        for (const [method, path, body] of [
            ['POST', '/api/v1/recipes', { ...PUBLIC_PUBLISHED, publicConfirmation: bad }],
            ['PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, publicConfirmation: bad }],
            ['PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'public', publicConfirmation: bad }],
        ] as const) {
            expect((await refusalOf(await call(method, path, body))).code).toBe('VALIDATION_FAILED');
        }

        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/v1/recipes', () => {
    it('REFUSES a create that is published and public with no confirmation: 400 PUBLIC_CONFIRMATION_REQUIRED, nothing written', async () => {
        const response = await call('POST', '/api/v1/recipes', PUBLIC_PUBLISHED);

        expect(await refusalOf(response)).toMatchObject(CONFIRMATION_REQUIRED);
        expect(create).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('REFUSES the DEFAULT create (no status, no visibility means published and public) the same way', async () => {
        expect(await refusalOf(await call('POST', '/api/v1/recipes', CREATE_BODY))).toMatchObject(
            CONFIRMATION_REQUIRED,
        );
    });

    it('records the confirmation as one implicit row, handed the write’s own transaction AFTER the recipe was written', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLIC_PUBLISHED, publicConfirmation: CONFIRM });

        expect(response.status).toBe(201);
        expect(insertMany).toHaveBeenCalledExactlyOnceWith(TX, [CONFIRM_ROW('create')]);
        expect(create.mock.invocationCallOrder[0]).toBeLessThan(insertMany.mock.invocationCallOrder[0] ?? 0);
    });

    it('records the statement and the confirmation of ONE request as two rows, the statement first', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLIC_PUBLISHED,
            statement: AUTHORED,
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(201);
        expect(recorded()).toEqual([
            STATEMENT_ROW('authored', 'statementAuthored.v1', 'create'),
            CONFIRM_ROW('create'),
        ]);
    });

    it('needs no confirmation for a PRIVATE create, and records none that it was sent', async () => {
        const without = await call('POST', '/api/v1/recipes', { ...CREATE_BODY, visibility: 'private' });
        const sent = await call('POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
            publicConfirmation: CONFIRM,
        });

        expect([without.status, sent.status]).toEqual([201, 201]);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('needs no confirmation for a public DRAFT (nothing is live), and records one the cook sent', async () => {
        const draft = { ...CREATE_BODY, status: 'draft', visibility: 'public' };

        expect((await call('POST', '/api/v1/recipes', draft)).status).toBe(201);
        expect(insertMany).not.toHaveBeenCalled();

        expect((await call('POST', '/api/v1/recipes', { ...draft, publicConfirmation: CONFIRM })).status).toBe(201);
        expect(recorded()).toEqual([CONFIRM_ROW('create')]);
    });

    it('ORDER: a statement still owed is refused as STATEMENT_REQUIRED before the confirmation is asked for', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLIC_PUBLISHED, contentPasted: true });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            details: { reason: 'STATEMENT_REQUIRED' },
        });
    });

    it('records a COOKBOOK: label, kind and credit, evidence by editorCitation, and one explicit row; the recipe is private', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
            statement: BOOK,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_physical',
                sourceKind: 'book',
                statementKind: 'source',
                sourceAttribution: 'Joy of Cooking, p. 12',
                visibility: 'private',
            }),
            TX,
        );
        expect(insertEvidence).toHaveBeenCalledExactlyOnceWith(
            TX,
            expect.objectContaining({
                recipeId: RECIPE_ID,
                capture: 'editorCitation',
                sourceKind: 'book',
                citation: BOOK.citation,
            }),
        );
        expect(recorded()).toEqual([STATEMENT_ROW('book', 'statementBook.v1', 'create')]);
    });

    it('refuses a cookbook asked to be PUBLIC: it is private only, whatever else the request says', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLIC_PUBLISHED,
            statement: BOOK,
            publicConfirmation: CONFIRM,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(create).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('still writes a web statement’s evidence by editorLink (the capture follows the kind)', async () => {
        await call('POST', '/api/v1/recipes', { ...CREATE_BODY, visibility: 'private', statement: WEB });

        expect(insertEvidence).toHaveBeenCalledWith(
            TX,
            expect.objectContaining({ capture: 'editorLink', sourceKind: 'public_web' }),
        );
        expect(recorded()).toEqual([STATEMENT_ROW('publicWeb', 'statementPublicWeb.v1', 'create')]);
    });

    it('records "from another person" with no source, no statement kind, and the recipe private', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...CREATE_BODY,
            visibility: 'private',
            statement: PERSON,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'user_created',
                sourceKind: null,
                statementKind: null,
                visibility: 'private',
            }),
            TX,
        );
        expect(insertEvidence).not.toHaveBeenCalled();
        expect(recorded()).toEqual([STATEMENT_ROW('fromPerson', 'statementFromPerson.v1', 'create')]);
    });

    it('refuses "from another person" asked to be PUBLIC: 400 INVALID_VISIBILITY FROM_PERSON_PRIVATE_ONLY, nothing written', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLIC_PUBLISHED,
            statement: PERSON,
            publicConfirmation: CONFIRM,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            code: 'INVALID_VISIBILITY',
            details: { reason: 'FROM_PERSON_PRIVATE_ONLY' },
        });
        expect(create).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id}', () => {
    it('REFUSES publishing a public draft with no confirmation: 400 PUBLIC_CONFIRMATION_REQUIRED, nothing written', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject(CONFIRMATION_REQUIRED);
        expect(update).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records the confirmation of a publish inside the write’s transaction, after the update landed', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(insertMany).toHaveBeenCalledExactlyOnceWith(TX, [CONFIRM_ROW('update')]);
        expect(update.mock.invocationCallOrder[0]).toBeLessThan(insertMany.mock.invocationCallOrder[0] ?? 0);
    });

    it('needs NO confirmation to save a recipe already published and public (nothing changes state), and records none', async () => {
        stored = rowOf({ visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Soup 2' });

        expect(response.status).toBe(200);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('judges "becomes public" on the visibility read UNDER THE ROW LOCK: a draft another request made public still needs it', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject(CONFIRMATION_REQUIRED);
    });

    it('needs none for a publish that ends private, and ignores one it was sent', async () => {
        stored = rowOf({ status: 'draft', visibility: 'private' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records a cleared statement as an explicit row with NO wording and NO locale', async () => {
        stored = rowOf({
            status: 'draft',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            statementKind: 'source',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(response.status).toBe(200);
        expect(recorded()).toEqual([
            {
                recipeId: RECIPE_ID,
                accountId: COOK,
                mode: 'explicit',
                choice: 'cleared',
                wordingVersion: null,
                locale: null,
                action: 'update',
            },
        ]);
    });

    it('a cookbook on a PUBLIC draft makes it private in the same write, writes evidence by editorCitation and one row', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: BOOK,
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                visibility: 'private',
                provenance: expect.objectContaining({ sourceKind: 'book' }),
            }),
            TX,
        );
        expect(insertEvidence).toHaveBeenCalledWith(
            TX,
            expect.objectContaining({ capture: 'editorCitation', citation: BOOK.citation }),
        );
        // The result is private, so the confirmation the cook sent is not recorded: only the statement is.
        expect(recorded()).toEqual([STATEMENT_ROW('book', 'statementBook.v1', 'update')]);
    });

    it('"from another person" on a PUBLIC draft makes it private in the same write, with no source', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: PERSON });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                visibility: 'private',
                provenance: expect.objectContaining({
                    sourceKind: null,
                    statementKind: null,
                    sourceType: 'user_created',
                }),
            }),
            TX,
        );
        expect(insertEvidence).not.toHaveBeenCalled();
        expect(recorded()).toEqual([STATEMENT_ROW('fromPerson', 'statementFromPerson.v1', 'update')]);
    });

    it('records nothing when the statement is refused as locked (403 SOURCE_LOCKED)', async () => {
        stored = rowOf({ statementKind: 'authored' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: PERSON });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records nothing on a VERSION CONFLICT (409): the stale write never ran', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public', currentVersion: 5 });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            statement: AUTHORED,
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(409);
        expect(update).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records nothing when the compare-and-swap loses (the update returns no row)', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });
        writeFindsNoRow = true;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
            statement: AUTHORED,
            publicConfirmation: CONFIRM,
        });

        expect(response.status).not.toBe(200);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('ORDER: the evidence rule answers before the confirmation is asked for', async () => {
        stored = rowOf({ status: 'draft', visibility: 'public' });
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

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject({ details: { reason: 'SOURCE_CONFLICT' } });
    });
});

describe('PATCH /api/v1/recipes/{id}/visibility', () => {
    it('REFUSES Public for a published private recipe with no confirmation: 400 PUBLIC_CONFIRMATION_REQUIRED, nothing written', async () => {
        stored = rowOf();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'public' });

        expect(await refusalOf(response)).toMatchObject(CONFIRMATION_REQUIRED);
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records the confirmation inside the write’s transaction, after the visibility landed', async () => {
        stored = rowOf();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(insertMany).toHaveBeenCalledExactlyOnceWith(TX, [CONFIRM_ROW('setVisibility')]);
        expect(setVisibility.mock.invocationCallOrder[0]).toBeLessThan(insertMany.mock.invocationCallOrder[0] ?? 0);
    });

    it('ACCEPTS and records the confirmation on a DRAFT (the editor’s Public choice), though it is not required there', async () => {
        stored = rowOf({ status: 'draft' });

        expect((await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'public' })).status).toBe(
            200,
        );
        expect(insertMany).not.toHaveBeenCalled();

        stored = rowOf({ status: 'draft' });
        expect(
            (
                await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: CONFIRM,
                })
            ).status,
        ).toBe(200);
        expect(recorded()).toEqual([CONFIRM_ROW('setVisibility')]);
    });

    it('needs none to go PRIVATE, and records none that it was sent', async () => {
        stored = rowOf({ visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('needs none for Public on a recipe that is ALREADY published and public (nothing changes state)', async () => {
        stored = rowOf({ visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'public' });

        expect(response.status).toBe(200);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('"I wrote this" and Public are ONE write: the statement is applied and recorded with the confirmation, statement first', async () => {
        stored = rowOf({ contentPastedAt: AT });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            statement: AUTHORED,
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledWith(
            RECIPE_ID,
            'public',
            TX,
            expect.objectContaining({ statementKind: 'authored', sourceType: 'user_created' }),
        );
        expect(recorded()).toEqual([
            STATEMENT_ROW('authored', 'statementAuthored.v1', 'setVisibility'),
            CONFIRM_ROW('setVisibility'),
        ]);
        expect(stored).toMatchObject({ visibility: 'public', statementKind: 'authored' });
    });

    it('pasted text plus "I wrote this" still goes through statementRequired and THEN sourceConflict, kept separate', async () => {
        stored = rowOf({ contentPastedAt: AT });

        // No statement: the statement rule refuses, even though the confirmation is present.
        const owed = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: CONFIRM,
        });
        expect(await refusalOf(owed)).toMatchObject({ details: { reason: 'STATEMENT_REQUIRED' } });

        // "I wrote this" over evidence of a third-party source: the evidence rule still refuses, and writes no row.
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
        const conflicted = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            statement: AUTHORED,
            publicConfirmation: CONFIRM,
        });
        expect(await refusalOf(conflicted)).toMatchObject({ details: { reason: 'SOURCE_CONFLICT' } });
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('a cookbook on set-visibility is applied with its evidence and one row, and Public for it is refused', async () => {
        stored = rowOf({ status: 'draft' });

        const privateBook = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
            statement: BOOK,
        });
        expect(privateBook.status).toBe(200);
        expect(insertEvidence).toHaveBeenCalledWith(TX, expect.objectContaining({ capture: 'editorCitation' }));
        expect(recorded()).toEqual([STATEMENT_ROW('book', 'statementBook.v1', 'setVisibility')]);

        stored = rowOf({ status: 'draft' });
        vi.clearAllMocks();
        const publicBook = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            statement: BOOK,
            publicConfirmation: CONFIRM,
        });
        expect(await refusalOf(publicBook)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('"from another person" with Public is a contradiction: 400 FROM_PERSON_PRIVATE_ONLY, nothing written; with Private it is recorded', async () => {
        stored = rowOf({ status: 'draft' });

        const publicPerson = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            statement: PERSON,
            publicConfirmation: CONFIRM,
        });
        expect(await refusalOf(publicPerson)).toMatchObject({ details: { reason: 'FROM_PERSON_PRIVATE_ONLY' } });
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();

        const privatePerson = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
            statement: PERSON,
        });
        expect(privatePerson.status).toBe(200);
        expect(recorded()).toEqual([STATEMENT_ROW('fromPerson', 'statementFromPerson.v1', 'setVisibility')]);
    });

    it('refuses a statement the source lock refuses (403 SOURCE_LOCKED), and writes nothing', async () => {
        stored = rowOf({ statementKind: 'authored' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
            statement: WEB,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(setVisibility).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('records nothing when the row vanished between the read and the write (404)', async () => {
        stored = rowOf();
        writeFindsNoRow = true;

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: CONFIRM,
        });

        expect(response.status).toBe(404);
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/v1/recipes/{id}/clone', () => {
    it('copies NO attestation: they are the acts of the cook who made them (the cloner makes their own)', async () => {
        stored = rowOf({ visibility: 'public' });

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(insertMany).not.toHaveBeenCalled();
    });
});
