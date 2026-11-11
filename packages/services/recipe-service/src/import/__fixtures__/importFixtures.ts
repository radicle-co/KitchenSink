/**
 * Fixture factories for the bulk import service tests (`make*` accepting `Partial<T>`).
 */
import {
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
    type Ingredient,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import { lineDigest, parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import type { Principal } from '../../auth/principal.js';
import { sha256Hex } from '../../common/sha256.js';
import { matchJudgementDigestOf } from '../../recipes/domain/matchProposal.js';
import type { ParseJobMatch } from '../../recipes/domain/parseJobMatch.js';
import type { RecipeResponse } from '../../recipes/dto/recipeResponse.dto.js';
import type { ImportView } from '../../recipes/import.schema.js';
import type { ParseJobResponse } from '../../recipes/parseJobs.schema.js';
import type { RecipeDrizzle } from '../../database/client.js';
import type { ImportedCreate } from '../../recipes/recipes.service.js';
import type { IngredientRow } from '../../database/schema/ingredients.js';
import type { ImportHeader } from '../dal/recipeImports.dal.js';
import type { ImportItem, ListedImportItem } from '../dal/recipeImportItems.dal.js';
import type { ImportLine } from '../dal/recipeImportLines.dal.js';
import type { PrivateSlotsPort } from '../privateSlots.port.js';

export const USER = '01JIMPORTSERVICEUSER0001';
export const IMPORT_ID = '66666666-6666-4666-8666-000000000001';

/** The verified cook. A free cook by default; pass `roles: ['premium']` for Premium. */
export function makePrincipal(overrides: Partial<Principal> = {}): Principal {
    return {
        userId: USER,
        sub: 'user_clerk',
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
        ...overrides,
    };
}

/** A slot port for tests that are not about slots: every cook has one free. */
export const UNLIMITED_PRIVATE_SLOTS: PrivateSlotsPort = { hasAvailable: () => Promise.resolve(true) };

/** An import header. */
export function makeHeader(overrides: Partial<ImportHeader> = {}): ImportHeader {
    return {
        id: IMPORT_ID,
        userId: USER,
        matchMode: 'keepAsWritten',
        visibility: 'public',
        expectedTotal: 3,
        cursorOrdinal: 0,
        reviewClosedAt: null,
        createdAt: new Date('2026-10-26T12:00:00.000Z'),
        createdAtIso: '2026-10-26T12:00:00.000000Z',
        updatedAt: new Date('2026-10-26T12:05:00.000Z'),
        ...overrides,
    };
}

/** An item. A received one, with no statement, by default. */
export function makeItem(overrides: Partial<ImportItem> = {}): ImportItem {
    return {
        importId: IMPORT_ID,
        ordinal: 0,
        title: 'Soup',
        payload: null,
        stage: 'received',
        review: 'pending',
        parseJobId: null,
        parseGeneration: 0,
        decisionRev: 0,
        allowanceSpentAt: null,
        matchedAt: null,
        savedAt: null,
        recipeId: null,
        statementKind: null,
        citation: null,
        sourceKind: null,
        visibility: null,
        cuisine: null,
        heldAtRev: null,
        servings: null,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        refusal: null,
        createdAt: new Date('2026-10-26T12:00:00.000Z'),
        updatedAt: new Date('2026-10-26T12:00:00.000Z'),
        ...overrides,
    };
}

/** An item as the list reads it. Its file states everything the save needs by default. */
export function makeListedItem(overrides: Partial<ListedImportItem> = {}): ListedImportItem {
    return {
        ...makeItem(overrides),
        saveFacts: {
            file: { cuisine: 'Italian', servings: 4, prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
            ingredientLineCount: 1,
            stepCount: 1,
        },
        ...overrides,
    };
}

/** A snapshot line. */
export function makeLine(overrides: Partial<ImportLine> = {}): ImportLine {
    return {
        id: '77777777-7777-4777-8777-000000000001',
        importId: IMPORT_ID,
        ordinal: 0,
        lineIndex: 0,
        foodIndex: 0,
        sourceLine: '2 cups whole milk',
        lineDigest: `v1:${'a'.repeat(64)}`,
        judgementDigest: 'jd-0',
        phrase: 'whole milk',
        quantity: '2',
        quantityHigh: null,
        unit: 'cup',
        statedQuantity: null,
        statedQuantityHigh: null,
        statedUnit: null,
        preparation: null,
        name: 'whole milk',
        displayText: null,
        note: null,
        matchedBy: 'lexical',
        foodId: 'F-whole',
        foodVariantId: null,
        rung: 'head',
        margin: 0.2,
        candidates: [{ kind: 'root', id: 'F-whole', rung: 'head', isDefault: false }],
        verificationKey: 'v1:proposal',
        savedVerificationKey: null,
        review: 'owed',
        pickedFoodId: null,
        pickedFoodVariantId: null,
        pickedAsWritten: false,
        pickedAgainstDigest: null,
        createdAt: new Date('2026-10-26T12:00:00.000Z'),
        ...overrides,
    };
}

/**
 * A CURRENT stored match for one food of a parse-job line: the judgement digest is the one the paste matcher computes for
 * that line's parse, so the snapshot builder treats it as the line's match.
 */
export function makeCurrentMatch(
    lineIndex: number,
    foodIndex: number,
    sourceLine: string,
    phrase: string,
    overrides: Partial<ParseJobMatch> = {},
    parse: { quantity: IngredientQuantity; unit: string | null; statedMeasure: string | null } = {
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
    },
): ParseJobMatch {
    const digest = parseStoredLineDigest(lineDigest(sourceLine, sha256Hex));

    return {
        lineIndex,
        foodIndex,
        lineDigest: digest,
        lineDigestNow: digest,
        judgementDigest: matchJudgementDigestOf(
            { lineDigest: digest, line: { sourceLine, ...parse }, foodIndex, phrase },
            sha256Hex,
        ),
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
        candidates: [
            { kind: 'root', id: 'F-whole', rung: 'head' },
            { kind: 'root', id: 'F-table', rung: 'default' },
        ],
        verificationKey: `v1:key-${String(lineIndex)}-${String(foodIndex)}`,
        review: 'owed',
        enqueuedAt: null,
        ...overrides,
    } as ParseJobMatch;
}

/** The recipe transaction handle the create path gives `afterWrite`. */
export type FakeTransaction = Parameters<NonNullable<ImportedCreate['afterWrite']>>[0];

/** What a create persisted, as `afterWrite` sees it. */
export type SavedRecipeFacts = Parameters<NonNullable<ImportedCreate['afterWrite']>>[1];

/**
 * The one opaque transaction handle. The service under test only passes it through to the fake's `afterWrite`; nothing reads
 * it, and a real one needs a database.
 */
export const FAKE_TRANSACTION = { tx: true } as unknown as FakeTransaction;

/**
 * The one opaque database handle. The code under test only passes it to a fake port; nothing reads it, and a real one needs
 * a database.
 */
export const FAKE_DATABASE = {} as unknown as RecipeDrizzle;

/** A recipe as `RecipesService.create` answers: published, user-created, private, with no lines. */
export function makeRecipeResponse(overrides: Partial<RecipeResponse> = {}): RecipeResponse {
    return {
        id: 'R-new',
        ownerId: USER,
        title: 'Soup',
        visibility: RecipeVisibility.PRIVATE,
        status: RecipeStatus.PUBLISHED,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        ingredients: [],
        steps: [],
        servings: 1,
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        totalTimeMinutes: 0,
        tags: [],
        dietaryFlags: [],
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-10-26T12:00:00.000Z',
        updatedAt: '2026-10-26T12:00:00.000Z',
        ...overrides,
    };
}

/** An import view with nothing in it. */
export function makeImportView(overrides: Partial<ImportView> = {}): ImportView {
    return {
        id: IMPORT_ID,
        matchMode: 'keepAsWritten',
        visibility: RecipeVisibility.PUBLIC,
        cursorOrdinal: 0,
        reviewClosed: false,
        version: 'v1',
        expectedTotal: 1,
        allowance: { limit: 1000, used: 0, resetsAt: null },
        pause: null,
        counts: { total: 0, received: 0, parsing: 0, matched: 0, saved: 0, refused: 0 },
        items: [],
        nextAfter: null,
        ...overrides,
    };
}

/** A parse job as the create path answers: running, with no lines yet. */
export function makeParseJobResponse(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: 'PJ-1',
        status: 'running',
        createdAt: '2026-10-26T12:00:00.000Z',
        expiresAt: '2026-10-27T12:00:00.000Z',
        lines: [],
        ...overrides,
    };
}

/** An ingredient binding as the ingredients service answers a bind. */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: 'LK-1',
        name: 'Milk, whole',
        isUserEntered: false,
        createdAt: '2026-10-26T12:00:00.000Z',
        ...overrides,
    };
}

/** A saved ingredient line (an `ingredients` row): 2 cups, bound to nothing in particular, no stated measure. */
export function makeIngredientRow(overrides: Partial<IngredientRow> = {}): IngredientRow {
    return {
        id: 'ING-1',
        recipeId: 'R-new',
        foodLookupId: 'LK-1',
        quantity: '2',
        quantityHigh: null,
        unit: 'cups',
        displayText: null,
        note: null,
        sourceLine: null,
        sourcePhrase: null,
        statedQuantity: null,
        statedQuantityHigh: null,
        statedUnit: null,
        preparation: null,
        groupLabel: null,
        boundBy: null,
        importLineId: null,
        sortOrder: 0,
        userCalories: null,
        userProteinG: null,
        userCarbsG: null,
        userFatG: null,
        ...overrides,
    };
}
