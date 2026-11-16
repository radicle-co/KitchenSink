/**
 * A pasted web link as the recipe's source, over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a, ADR-0089): the real `AppModule` — routing, the zod pipe, the auth middleware,
 * `RecipesService` and its provenance, visibility and publish policies, the exception filter — with the DALs replaced by
 * doubles and food faked at the network.
 *
 * It pins what the unit tier cannot: that the `statement` reaches the DAL as the four resolved source columns (never as the
 * body stated them), that a web copy is private on the way in, that the correction window closes at the first publish, and
 * that every refusal reaches the wire as the published envelope.
 *
 * Whether the real database stores and constrains the columns is the LOCAL e2e tier's (`recipeSourceKind.e2e.test.ts`).
 *
 * 0087: the provenance expectations here were rewritten to prove the NEW behaviour, a fifth resolved column `statementKind`
 * (`source` for a stated web copy, `null` for no statement); the statement rule's own routes are `statementRule.integration.test.ts`.
 */
import { PUBLIC_CONFIRMATION_FOR_API_WRITERS } from '@kitchensink/recipe-core';
import 'reflect-metadata';

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
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const STATEMENT = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;

/** The recipe the double holds. Each test sets it. */
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

/**
 * The evidence table as a double: stateful, so a statement written by one request is read by the next, which is the whole
 * of the rule under test. `insertEvidence` records the transaction it was handed, so a test can prove it is the write's own.
 */
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

/** A create body that is a DRAFT, so no private slot is counted: the slot rule is the unchanged one, not this suite's. */
const DRAFT_BODY = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Simmer.' }],
    status: 'draft',
};

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

describe('POST /api/v1/recipes — a statement makes a private web copy', () => {
    it('persists the four resolved source columns and the private visibility', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceUrl: LINK,
                sourceAttribution: 'allrecipes.com',
                sourceKind: 'public_web',
                visibility: 'private',
            }),
            expect.anything(),
        );
    });

    it('stores a link whose own brackets close it whole, and drops only the sentence punctuation after it', async () => {
        const page = 'https://en.wikipedia.org/wiki/Pie_(food)';
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: {
                kind: 'public_web',
                citation: `${page}.`,
                wording: { version: 'statementPublicWeb.v1', locale: 'en' },
            },
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ sourceUrl: page, sourceAttribution: 'wikipedia.org' }),
            expect.anything(),
        );
    });

    it('returns the kind, so a client can judge the source from the response', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(await response.json()).toMatchObject({
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });
    });

    it('refuses public for a web copy with the existing private-only denial, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...DRAFT_BODY, statement: STATEMENT });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(create).not.toHaveBeenCalled();
    });

    it('asks a web copy for a cuisine to publish, unlike the curator’s text', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            status: 'published',
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            code: 'PUBLISH_REQUIREMENTS_UNMET',
            details: { missing: ['cuisine'] },
        });
    });

    it('answers 400 for a body carrying BOTH the curator source and the statement, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
            source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/b', sourceAttribution: 'A book' },
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });

    it('answers 400 for a statement whose link is our own site', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: {
                kind: 'public_web',
                citation: 'https://commise.app/recipes/1',
                wording: { version: 'statementPublicWeb.v1', locale: 'en' },
            },
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id} — the source can be settled until the first publish (ADR-0058, ADR-0089)', () => {
    it('sets a statement on a never-published draft, and the public draft becomes private in the same write', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                visibility: 'private',
                provenance: {
                    sourceType: 'imported_public',
                    sourceUrl: LINK,
                    sourceAttribution: 'allrecipes.com',
                    sourceKind: 'public_web',
                    statementKind: 'source',
                },
            }),
            expect.anything(),
        );
        expect(await response.json()).toMatchObject({ visibility: 'private', sourceKind: 'public_web' });
    });

    it('sets Private on EVERY write that sets a source, whatever visibility the read saw', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', visibility: 'private' });

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: STATEMENT });

        expect(update.mock.calls[0]?.[1]).toHaveProperty('visibility', 'private');
    });

    it('refuses a statement on a clone whose web source was inherited (no relabel by clone)', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            clonedFromId: '00000000-0000-4000-8000-0000000000c1',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('clears the statement with null: the source goes back to none and visibility is left as it is', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                provenance: {
                    sourceType: 'user_created',
                    sourceUrl: null,
                    sourceAttribution: null,
                    sourceKind: null,
                    statementKind: null,
                },
            }),
            expect.anything(),
        );
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('visibility');
    });

    it('leaves the source alone when the body carries no statement', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft' });

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Soup 2' });

        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('provenance');
    });

    // Rewritten by ADR-0092: a recipe with no statement may now take a first statement after the first publish, so the lock is
    // proved on a recipe that already holds one.
    it('refuses CHANGING a stated source after the first publish with 403 FORBIDDEN, details.reason SOURCE_LOCKED, writing nothing', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            cuisine: 'Italian',
            statementKind: 'authored',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { reason: 'SOURCE_LOCKED' },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('also refuses clearing a statement after the first publish, and a re-drafted recipe stays locked', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            firstPublishedAt: AT,
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
            visibility: 'private',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses to overwrite a source the cook did not state (the curator’s text), even on a draft', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            sourceType: 'imported_public',
            sourceKind: null,
            sourceUrl: 'https://www.gutenberg.org/cache/epub/1/pg1.txt',
            sourceAttribution: 'A book',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses to PUBLISH a public web-copy draft (the state after the write), writing nothing', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'public',
            cuisine: 'Italian',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(update).not.toHaveBeenCalled();
    });

    it('still answers 400 for the curator `source` on a PATCH: provenance by declaration is create-only', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/b', sourceAttribution: 'A book' },
        });

        expect(response.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
    });
});

// The bulk import (ADR-0072 section 9) calls `RecipesService.create` with its statement's provenance, an INTERNAL argument. A
// web statement must resolve to the web copy and so can never be saved public, whatever the item asked for.
describe('RecipesService.create with the bulk import’s provenance (ADR-0089)', () => {
    const importedPrincipal: Principal = {
        userId: COOK,
        sub: `test:${COOK}`,
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };
    const provenance = resolveStatementProvenance({ kind: 'public_web', citation: LINK });

    function createWith(over: Record<string, unknown>) {
        if (provenance === undefined) {
            throw new Error('test setup: the statement must resolve');
        }

        return booted.app
            .get(RecipesService)
            .create(importedPrincipal, createRecipeRequestSchema.parse({ ...DRAFT_BODY, ...over }), undefined, {
                provenance,
                lineOrigins: [{ kind: 'cook' }],
            });
    }

    it('REFUSES a public save of a public_web item, and writes nothing', async () => {
        await expect(
            createWith({ visibility: 'public', publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS }),
        ).rejects.toMatchObject({ code: 'INVALID_VISIBILITY' });
        expect(create).not.toHaveBeenCalled();
    });

    it('a private save stores the web copy WITH its kind, so it never reads as the curator’s text', async () => {
        await createWith({ visibility: 'private' });

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: LINK,
                visibility: 'private',
            }),
            expect.anything(),
        );
    });
});

describe('PATCH /api/v1/recipes/{id}/visibility — judged on the source under the row lock (ADR-0089)', () => {
    it('refuses PUBLIC for a recipe a concurrent PATCH made a web copy after it was read, writing nothing', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'published', visibility: 'private' });
        underLock = {
            ...stored,
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
        };

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect((await refusalOf(response)).code).toBe('INVALID_VISIBILITY');
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('makes the same cook-written recipe public when the row under the lock is unchanged', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'published', visibility: 'private' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(response.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledOnce();
    });
});

describe('POST /api/v1/recipes/{id}/clone — the kind travels with the source', () => {
    it('copies the source kind, and the clone of a web copy lands private', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: LINK,
                visibility: 'private',
            }),
            expect.anything(),
        );
    });
});

/**
 * THE EVIDENCE RULE: a recipe that EVER had a third-party source stated may not be Public, even
 * after the cook clears the statement. This block is the named path, one request at a time, over the real pipeline with the
 * evidence table as a stateful double. Private is never refused by it.
 */
describe('the evidence rule: a cleared source does not make a copied recipe the cook’s own work', () => {
    /** The draft a cook reaches by stating a link, then clearing it: cook-written on its face, with evidence behind it. */
    function clearedDraft(over: Partial<RecipeRow> = {}): RecipeRow {
        return makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', visibility: 'private', ...over });
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

    it('THE NAMED PATH: state a web source, clear it, then ask for Public: 400 INVALID_VISIBILITY, reason SOURCE_CONFLICT', async () => {
        const created = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
        });
        expect(created.status).toBe(201);

        const cleared = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });
        expect(cleared.status).toBe(200);
        // The recipe now reads as the cook's own...
        expect(stored).toMatchObject({ sourceType: 'user_created', sourceKind: null, sourceUrl: null });

        const asked = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(await refusalOf(asked)).toMatchObject({
            status: 400,
            code: 'INVALID_VISIBILITY',
            details: { reason: 'SOURCE_CONFLICT' },
        });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('also refuses to PUBLISH a public draft that raced there, with the same reason, writing nothing', async () => {
        stored = clearedDraft({ visibility: 'public', cuisine: 'Italian' });
        webEvidence();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            code: 'INVALID_VISIBILITY',
            details: { reason: 'SOURCE_CONFLICT' },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('lets the same recipe be PRIVATE: the rule never refuses Private', async () => {
        stored = clearedDraft({ visibility: 'public' });
        webEvidence();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private' });

        expect(response.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledWith(RECIPE_ID, 'private', expect.anything(), undefined);
    });

    it('lands the CLONE of such a recipe private, and the original is untouched', async () => {
        stored = clearedDraft({ status: 'published', visibility: 'public', cuisine: 'Italian' });
        webEvidence();

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), expect.anything());
    });

    it('a recipe that never had a source can be made Public (the control, so the refusal is the evidence’s)', async () => {
        stored = clearedDraft();

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(response.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledOnce();
    });

    it('the clone of a recipe that never had a source is Public, as before', async () => {
        stored = clearedDraft({ status: 'published', visibility: 'public' });

        await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }), expect.anything());
    });

    it('writes the evidence row in the SAME transaction as the create that states the source', async () => {
        await call('POST', '/api/v1/recipes', { ...DRAFT_BODY, visibility: 'private', statement: STATEMENT });

        expect(insertEvidence).toHaveBeenCalledOnce();
        expect(insertEvidence.mock.calls[0]?.[0]).toBe(create.mock.calls[0]?.[1]);
        expect(insertEvidence.mock.calls[0]?.[1]).toMatchObject({
            recipeId: RECIPE_ID,
            capture: 'editorLink',
            sourceUrl: LINK,
            sourceDomain: 'allrecipes.com',
            sourceKind: 'public_web',
        });
    });

    it('writes the evidence row in the same transaction as a PATCH that applies a statement', async () => {
        stored = clearedDraft();

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: STATEMENT });

        expect(insertEvidence).toHaveBeenCalledOnce();
        expect(insertEvidence.mock.calls[0]?.[0]).toBe(update.mock.calls[0]?.[2]);
        expect(insertEvidence.mock.calls[0]?.[1]).toMatchObject({ recipeId: RECIPE_ID, capture: 'editorLink' });
    });

    it('writes NO evidence for a recipe with no statement, for a clear, or for an unrelated PATCH', async () => {
        await call('POST', '/api/v1/recipes', { ...DRAFT_BODY });
        stored = clearedDraft({ sourceType: 'imported_public', sourceKind: 'public_web', sourceUrl: LINK });
        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });
        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 2, title: 'Soup 2' });

        expect(insertEvidence).not.toHaveBeenCalled();
    });

    it('writes the import’s evidence as importFile, in the create’s transaction', async () => {
        const provenance = resolveStatementProvenance({ kind: 'book', citation: 'Joy of Cooking' });

        if (provenance === undefined) {
            throw new Error('test setup: the statement must resolve');
        }

        await booted.app.get(RecipesService).create(
            {
                userId: COOK,
                sub: `test:${COOK}`,
                scopes: [],
                permissions: [],
                roles: [],
                principalKind: 'real',
                containment: 'enforce',
            },
            createRecipeRequestSchema.parse({ ...DRAFT_BODY, visibility: 'private' }),
            undefined,
            { provenance, lineOrigins: [{ kind: 'cook' }] },
        );

        expect(insertEvidence.mock.calls[0]?.[0]).toBe(create.mock.calls[0]?.[1]);
        expect(insertEvidence.mock.calls[0]?.[1]).toMatchObject({
            capture: 'importFile',
            sourceKind: 'book',
            citation: 'Joy of Cooking',
        });
    });
});
