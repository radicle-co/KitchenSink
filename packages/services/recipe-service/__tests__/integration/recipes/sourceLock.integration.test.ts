/**
 * P8 (ADR-0100, plan everyAnswerSourceLock U2): a CONFIRMED source answer is locked against the cook on every route that writes a
 * statement, a staff-corrected recipe is refused Public with SOURCE_CORRECTED, a restatement writes nothing but its attestation, and
 * no log event carries an answer. Over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` section
 * 7.1a): the real policy, service and gate, with the DALs as doubles. That the database sets the confirmation and holds the
 * recipe is the LOCAL e2e tier's (`sourceLock.e2e.test.ts`, `recipeSourceLock.e2e.test.ts`).
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

const COOK = '01JSOURCELOCKCOOK000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000a8';
const AT = new Date('2026-11-20T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000a801',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const TX = { __tx: true };

const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

let stored: RecipeRow;
/** The private recipes the free cook holds, as the slot count under the lock reads them. */
let heldSlots = 0;
/** What a read OUTSIDE the lock sees (`findById`), when it differs from the locked row: a write that raced the statement. */
let preLockStatementKind: RecipeRow['statementKind'] | undefined;

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
const insertMany = vi.fn(async (_tx: unknown, _rows: readonly unknown[]) => undefined);
const hasFromPerson = vi.fn(async (_tx: unknown, _recipeId: string) => false);
const hasWorded = vi.fn(async (_tx: unknown, _recipeId: string, _choice: string) => false);

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
                    findById: async (id: string) =>
                        id === RECIPE_ID
                            ? aggregateOf(
                                  preLockStatementKind === undefined
                                      ? stored
                                      : { ...stored, statementKind: preLockStatementKind },
                              )
                            : undefined,
                    privateFoodLines: async () => [],
                    lockAndCountPrivateSlots: async () => heldSlots,
                    lockSlotFacts: async () => ({
                        visibility: stored.visibility,
                        status: stored.status,
                        sourceType: stored.sourceType,
                        sourceKind: stored.sourceKind,
                        sourceUrl: stored.sourceUrl,
                        sourceConfirmedAt: stored.sourceConfirmedAt,
                        sourceCorrectionHold: stored.sourceCorrectionHold,
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
            {
                provide: RecipeStatementAttestationsDal,
                useValue: { insertMany, hasFromPerson, hasWordedAttestation: hasWorded },
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
    heldSlots = 0;
    preLockStatementKind = undefined;
    vi.clearAllMocks();
    hasFromPerson.mockImplementation(async () => false);
    hasWorded.mockImplementation(async () => false);
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const WEB = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
const OTHER_WEB = { ...WEB, citation: 'https://www.allrecipes.com/recipe/2/stew/' } as const;
const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking, p. 12',
    wording: { version: 'statementBook.v1', locale: 'en' },
} as const;
const OTHER_BOOK = { ...BOOK, citation: 'Another Book, p. 1' } as const;
const PAID = {
    kind: 'paid_site',
    citation: 'Sam’s Subscription Kitchen',
    wording: { version: 'statementPaidSite.v1', locale: 'en' },
} as const;
const CONFIRMED_AT = new Date('2026-11-10T00:00:00.000Z');

/** Each arm of the lock: the stored answer, and a move that is NOT a restatement of it. */
const ARMS = [
    {
        name: 'a web copy',
        row: {
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            statementKind: 'source',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        },
        move: BOOK,
    },
    {
        name: 'a book',
        row: {
            sourceType: 'imported_physical',
            sourceKind: 'book',
            statementKind: 'source',
            sourceAttribution: BOOK.citation,
        },
        move: OTHER_BOOK,
    },
    {
        name: 'a paid site',
        row: {
            sourceType: 'imported_paid',
            sourceKind: 'paid_site',
            statementKind: 'source',
            sourceAttribution: PAID.citation,
        },
        move: AUTHORED,
    },
    { name: 'another person', row: { statementKind: 'fromPerson' }, move: AUTHORED },
    { name: 'my own answer (a web link)', row: { statementKind: 'authored' }, move: WEB },
] as const;

const CALLERS = [
    {
        name: 'the editor save (PATCH)',
        status: 'published',
        send: (statement: unknown) => call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement }),
    },
    {
        name: 'a publish request (PATCH with a status)',
        status: 'draft',
        send: (statement: unknown) =>
            call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, status: 'published', statement }),
    },
    {
        name: 'the Make public sheet (set-visibility)',
        status: 'published',
        send: (statement: unknown) =>
            call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                statement,
            }),
    },
] as const;

/** Whether a response is the lock's refusal. A request for Public with a web link meets the private-only rule, which is not the lock. */
async function lockRefusalOf(response: Response): Promise<boolean> {
    if (response.status !== 403) {
        return false;
    }

    const refusal = await refusalOf(response);

    return JSON.stringify(refusal.details).includes('SOURCE_LOCKED');
}

function expectNothingWritten(): void {
    expect(update).not.toHaveBeenCalled();
    expect(setVisibility).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
}

describe('a confirmed answer is locked on every route (KTD-1, AE1, AE2, AE3, AE5)', () => {
    it.each(CALLERS.flatMap((caller) => ARMS.map((arm) => ({ caller, arm }))))(
        '$caller.name over $arm.name: 403 SOURCE_LOCKED, nothing written, visibility unchanged',
        async ({ caller, arm }) => {
            stored = makeRecipeRow({
                id: RECIPE_ID,
                ownerId: COOK,
                status: caller.status,
                visibility: 'private',
                cuisine: 'italian',
                sourceConfirmedAt: CONFIRMED_AT,
                ...arm.row,
            });

            const response = await caller.send(arm.move);

            expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
            expectNothingWritten();
            expect(stored).toMatchObject({ visibility: 'private', ...arm.row });
        },
    );

    // "Another person" and a paid site stay locked whatever the confirmation says (today's locks), so only the arms the confirmation
    // alone locks have an open twin. An unconfirmed recipe is a DRAFT: a published one is confirmed by the database.
    const TWIN_ARMS = ARMS.filter((arm) => arm.row.statementKind !== 'fromPerson' && arm.name !== 'a paid site');

    it.each(CALLERS.flatMap((caller) => TWIN_ARMS.map((arm) => ({ caller, arm }))))(
        'the same move on an UNCONFIRMED draft holding $arm.name through $caller.name is not refused by the lock (the twin)',
        async ({ caller, arm }) => {
            stored = makeRecipeRow({
                id: RECIPE_ID,
                ownerId: COOK,
                status: 'draft',
                visibility: 'private',
                cuisine: 'italian',
                sourceConfirmedAt: null,
                ...arm.row,
            });

            const response = await caller.send(arm.move);

            expect(await lockRefusalOf(response)).toBe(false);
        },
    );

    it.each(CALLERS)(
        '$name over a confirmed recipe with NO answer applies: confirmed alone locks nothing (AE20)',
        async (caller) => {
            stored = makeRecipeRow({
                id: RECIPE_ID,
                ownerId: COOK,
                status: caller.status,
                visibility: 'private',
                cuisine: 'italian',
                sourceConfirmedAt: CONFIRMED_AT,
                statementKind: null,
            });

            const response = await caller.send(WEB);

            expect(await lockRefusalOf(response)).toBe(false);
        },
    );
});

describe('a confirmed own answer can only be downgraded, and the recipe is private in the same write (AE4)', () => {
    it.each([
        ['a book', BOOK],
        ['a paid site', PAID],
    ] as const)('PATCH to %s applies and writes visibility private', async (_name, statement) => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'public',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            statementKind: 'authored',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                visibility: 'private',
                provenance: expect.objectContaining({ statementKind: 'source' }),
            }),
            expect.anything(),
        );
        expect(stored).toMatchObject({ visibility: 'private' });
    });

    it('a downgrade that needs a private slot is refused PRIVATE_SLOTS_FULL at the limit, and the answer stays (AE19)', async () => {
        heldSlots = 50;
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'public',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            statementKind: 'authored',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: BOOK });

        expect(await refusalOf(response)).toMatchObject({ status: 403, code: 'PRIVATE_SLOTS_FULL' });
        expect(update).not.toHaveBeenCalled();
        expect(stored).toMatchObject({ statementKind: 'authored', visibility: 'public' });
    });

    it('after the downgrade the answer is locked: the book cannot go back to "I wrote this" (AE4)', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceType: 'imported_physical',
            sourceKind: 'book',
            statementKind: 'source',
            sourceAttribution: BOOK.citation,
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: AUTHORED,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
    });
});

describe('a restatement writes no columns and no evidence (KTD-2, AE6, AE15)', () => {
    const BOOK_ROW = {
        sourceType: 'imported_physical',
        sourceKind: 'book',
        statementKind: 'source',
        sourceAttribution: BOOK.citation,
        sourceConfirmedAt: CONFIRMED_AT,
    } as const;

    it('PATCH of the stored book title is 200 with no source write and no evidence', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            ...BOOK_ROW,
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: BOOK });

        expect(response.status).toBe(200);
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('provenance');
        expect(insertEvidence).not.toHaveBeenCalled();
    });

    it('set-visibility with the stored title and a wording records the attestation ONCE: written when none is held', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            ...BOOK_ROW,
        });
        hasWorded.mockImplementation(
            async (tx, recipeId, choice) => tx === TX && recipeId === RECIPE_ID && choice === 'book' && false,
        );

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'private',
            statement: BOOK,
        });

        expect(insertEvidence).not.toHaveBeenCalled();
        expect(hasWorded).toHaveBeenCalledWith(TX, RECIPE_ID, 'book');
        expect(insertMany).toHaveBeenCalledOnce();
        expect(insertMany.mock.calls[0]?.[1]).toEqual([
            expect.objectContaining({ choice: 'book', wordingVersion: 'statementBook.v1', action: 'setVisibility' }),
        ]);
    });

    it('...and NOT written when a worded attestation of that answer is already held', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            ...BOOK_ROW,
        });
        hasWorded.mockImplementation(
            async (tx, recipeId, choice) => tx === TX && recipeId === RECIPE_ID && choice === 'book',
        );

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private', statement: BOOK });

        expect(hasWorded).toHaveBeenCalledWith(TX, RECIPE_ID, 'book');
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('...and a restatement with no wording records nothing and does not even ask', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            ...BOOK_ROW,
        });
        const { wording: _wording, ...unworded } = BOOK;

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private', statement: unworded });

        expect(hasWorded).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('a different title is locked, and a different link over an UNCONFIRMED web copy applies', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            ...BOOK_ROW,
        });

        expect(
            await refusalOf(
                await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: OTHER_BOOK }),
            ),
        ).toMatchObject({ status: 403 });

        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            cuisine: 'italian',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            statementKind: 'source',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
            sourceConfirmedAt: null,
        });

        expect(
            (await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: OTHER_WEB })).status,
        ).toBe(200);
    });
});

describe('a staff-corrected recipe is held off Public (KTD-4, AE9)', () => {
    it('set-visibility Public on a held recipe is 400 INVALID_VISIBILITY, reason SOURCE_CORRECTED, nothing written', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceCorrectionHold: true,
            statementKind: 'authored',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, details: { reason: 'SOURCE_CORRECTED' } });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('the same recipe unheld goes Public: the hold is the only difference', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceCorrectionHold: false,
            statementKind: 'authored',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(response.status).toBe(200);
    });

    it('a clone of a held recipe defaults to private (the wiring; the database also forces it, see the LOCAL e2e)', async () => {
        // A held recipe is private by the CHECK, which would make the clone private for that reason alone. The double states the
        // impossible public held row so that only the hold can make this clone private.
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'public',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceCorrectionHold: true,
        });

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), expect.anything());
    });

    it('Private is never refused by the hold', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            cuisine: 'italian',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceCorrectionHold: true,
        });

        expect((await call('PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private' })).status).toBe(
            200,
        );
    });

    it('the owner detail carries sourceConfirmed and sourceCorrected (KTD-9)', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            sourceConfirmedAt: CONFIRMED_AT,
            sourceCorrectionHold: true,
        });

        const response = await asPrincipal(COOK, () =>
            fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}`, { headers: { authorization: bearerFor(COOK) } }),
        );
        const body = (await response.json()) as Record<string, unknown>;

        expect(body).toMatchObject({ sourceConfirmed: true, sourceCorrected: true });
    });
});

describe('the lock refusal event carries no answer (qse Q-3)', () => {
    it('writes one source.lockRefused line whose payload holds none of the request’s citation, link or wording', async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
            lines.push(String(line));
        });

        try {
            stored = makeRecipeRow({
                id: RECIPE_ID,
                ownerId: COOK,
                status: 'published',
                visibility: 'private',
                cuisine: 'italian',
                sourceConfirmedAt: CONFIRMED_AT,
                statementKind: 'authored',
            });

            await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
                expectedVersion: 1,
                statement: { ...WEB, citation: 'https://example.com/PRIVATE-CITATION-TEXT' },
            });
        } finally {
            spy.mockRestore();
        }

        const events = lines.filter((line) => line.includes('source.lockRefused'));

        expect(events).toHaveLength(1);
        expect(events[0]).not.toContain('PRIVATE-CITATION-TEXT');
        expect(events[0]).not.toContain('statementPublicWeb');
        expect(JSON.parse(events[0] ?? '{}')).toMatchObject({ event: 'source.lockRefused', route: 'update' });
    });
});
