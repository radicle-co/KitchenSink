/**
 * Tests for the pure ingredient-resolver model (CP-6/P2) — `nextMatchAction`, `isTerminalStatus`,
 * `isUnresolvedStatus`, `toIngredientLine`, and `deriveViewState`. No React, no client hooks: these are
 * plain functions over plain data, extracted from the near-identical `IngredientPicker` leaves (web +
 * mobile) so the branch decisions are unit-testable independent of `useIngredientResolver`'s React/TanStack
 * wiring.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import type { IngredientCandidate } from '@kitchensink/recipe-service-client';
import { describe, expect, it } from 'vitest';

import {
    deriveViewState,
    isTerminalStatus,
    isUnresolvedStatus,
    MIN_INGREDIENT_QUERY_LENGTH,
    meetsIngredientSearchThreshold,
    nextMatchAction,
    rankIngredientResults,
    toIngredientLine,
    type DeriveViewStateInput,
} from '../ingredientResolver.model.js';

/**
 * A complete `deriveViewState` input with every field at its "nothing happening" default, overridable.
 * `debouncedTrimmed` defaults to whatever `trimmed` resolves to (i.e. "the debounce has already
 * settled") unless a test overrides it explicitly — so every pre-existing test that only cares about
 * `trimmed` keeps its "settled" assumption, and only the debounce-pending tests below need to name
 * `debouncedTrimmed` themselves.
 */
function baseInput(overrides: Partial<DeriveViewStateInput> = {}): DeriveViewStateInput {
    return {
        disambiguating: null,
        trimmed: '',
        debouncedTrimmed: overrides.trimmed ?? '',
        results: [],
        searchIsLoading: false,
        searchIsSuccess: false,
        searchIsError: false,
        candidatesData: undefined,
        candidatesIsLoading: false,
        candidatesIsError: false,
        resolveIsPending: false,
        ...overrides,
    };
}

const CANDIDATE: IngredientCandidate = {
    candidateId: 'cand-a',
    source: 'usda',
    externalKey: 'k1',
    name: 'Black pepper',
    summary: null,
};

describe('nextMatchAction — exhaustive over FoodResolutionStatus', () => {
    it.each([
        [FoodResolutionStatus.PENDING, 'resolve'],
        [FoodResolutionStatus.UNRESOLVED, 'disambiguate'],
        [FoodResolutionStatus.RESOLVED, 'resolve'],
        [FoodResolutionStatus.NOT_FOUND, 'resolve'],
        [FoodResolutionStatus.FAILED, 'resolve'],
    ] as const)('%s -> %s', (status, expected) => {
        expect(nextMatchAction(status)).toBe(expected);
    });

    it('treats an absent status (a freeform ingredient) as resolve — nothing to disambiguate', () => {
        expect(nextMatchAction(undefined)).toBe('resolve');
    });
});

describe('isTerminalStatus', () => {
    it.each([
        [FoodResolutionStatus.NOT_FOUND, true],
        [FoodResolutionStatus.FAILED, true],
        [FoodResolutionStatus.PENDING, false],
        [FoodResolutionStatus.UNRESOLVED, false],
        [FoodResolutionStatus.RESOLVED, false],
    ] as const)('%s -> %s', (status, expected) => {
        expect(isTerminalStatus(status)).toBe(expected);
    });

    it('is false for an absent status', () => {
        expect(isTerminalStatus(undefined)).toBe(false);
    });
});

describe('isUnresolvedStatus', () => {
    it('is true only for UNRESOLVED', () => {
        expect(isUnresolvedStatus(FoodResolutionStatus.UNRESOLVED)).toBe(true);
        expect(isUnresolvedStatus(FoodResolutionStatus.RESOLVED)).toBe(false);
        expect(isUnresolvedStatus(undefined)).toBe(false);
    });
});

describe('toIngredientLine', () => {
    it('projects a catalog ingredient onto a form line, defaulting quantity to 1', () => {
        const ingredient = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });

        expect(toIngredientLine(ingredient)).toEqual({
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('omits resolutionStatus entirely when the catalog row carries none', () => {
        const ingredient: Ingredient = {
            id: 'ing_free',
            name: 'Grandma’s spice mix',
            isUserEntered: true,
            createdAt: '2026-04-01T09:00:00.000Z',
        };

        expect(toIngredientLine(ingredient)).toEqual({
            ingredientId: 'ing_free',
            name: 'Grandma’s spice mix',
            quantity: 1,
        });
        expect('resolutionStatus' in toIngredientLine(ingredient)).toBe(false);
    });

    it('carries per-100g nutrition + household portions onto the form line when the catalog row has them (E3)', () => {
        const ingredient = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            caloriesPer100g: 884,
            proteinGPer100g: 0,
            carbsGPer100g: 0,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });

        expect(toIngredientLine(ingredient)).toEqual({
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
            caloriesPer100g: 884,
            proteinGPer100g: 0,
            carbsGPer100g: 0,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });
    });

    it('omits every nutrition field when the catalog row carries none (still resolving, or genuinely absent)', () => {
        const ingredient: Ingredient = {
            id: 'ing_10',
            name: 'Sourdough starter',
            isUserEntered: true,
            createdAt: '2026-04-01T09:00:00.000Z',
        };

        const line = toIngredientLine(ingredient);

        expect(line).toEqual({ ingredientId: 'ing_10', name: 'Sourdough starter', quantity: 1 });
        expect('caloriesPer100g' in line).toBe(false);
        expect('proteinGPer100g' in line).toBe(false);
        expect('carbsGPer100g' in line).toBe(false);
        expect('fatGPer100g' in line).toBe(false);
        expect('portions' in line).toBe(false);
    });
});

describe('deriveViewState', () => {
    it('is idle when the query is blank and nothing is being disambiguated', () => {
        expect(deriveViewState(baseInput())).toEqual({ kind: 'idle' });
    });

    it('is searching while the search is in flight', () => {
        expect(deriveViewState(baseInput({ trimmed: 'oli', searchIsLoading: true }))).toEqual({ kind: 'searching' });
    });

    // Regression (final-review Finding 1): the debounce split the live gating query (`trimmed`) from the
    // query that ENABLES the TanStack fetch (`debouncedTrimmed`). At the instant `trimmed` crosses the
    // 2-char threshold, the debounced value hasn't caught up yet, so the search query is still
    // `enabled: false` and `searchIsLoading` is `false` — NOT because the search returned zero results,
    // but because it hasn't started. Before the fix, `deriveViewState` fell through to `results: []`,
    // flashing the "no matches — create one" affordance for the whole debounce window.
    it('is searching — never the empty results/create-freeform state — the instant trimmed crosses the threshold, before the debounced query catches up', () => {
        expect(
            deriveViewState(
                baseInput({
                    trimmed: 'ab',
                    debouncedTrimmed: 'a', // still the PREVIOUS (sub-threshold) debounced value
                    searchIsLoading: false,
                    searchIsSuccess: false,
                }),
            ),
        ).toEqual({ kind: 'searching' });
    });

    it('stays searching even when a stale debounced value happens to carry old (now-irrelevant) result data', () => {
        // Guards against a "just check results.length" shortcut: even with leftover `results` from a
        // PRIOR (now-stale) query, the debounce-pending window must still be `searching`, never `results`.
        const stale = makeIngredient({ id: 'ing_stale', name: 'Stale' });

        expect(
            deriveViewState(
                baseInput({
                    trimmed: 'oli',
                    debouncedTrimmed: 'ol',
                    searchIsLoading: false,
                    searchIsSuccess: true,
                    results: [stale],
                }),
            ),
        ).toEqual({ kind: 'searching' });
    });

    it('is results (empty) once the debounce has genuinely settled and the search itself came back empty', () => {
        // `debouncedTrimmed` explicitly equals `trimmed` here (the debounce settled) — proves the fix does
        // not mask the REAL empty state, only the transient pending-debounce window above.
        expect(
            deriveViewState(baseInput({ trimmed: 'zzz', debouncedTrimmed: 'zzz', searchIsSuccess: true, results: [] })),
        ).toEqual({ kind: 'results', results: [], isSuccess: true, isError: false });
    });

    it('is idle below the 2-character trigger (REQ-057), even with a match already loaded', () => {
        const hit = makeIngredient({ id: 'ing_9', name: 'Salt' });

        expect(
            deriveViewState(baseInput({ trimmed: 's', searchIsSuccess: true, searchIsLoading: true, results: [hit] })),
        ).toEqual({ kind: 'idle' });
    });

    it('is results (empty) once the search settles with no matches', () => {
        expect(deriveViewState(baseInput({ trimmed: 'zzz', searchIsSuccess: true, results: [] }))).toEqual({
            kind: 'results',
            results: [],
            isSuccess: true,
            isError: false,
        });
    });

    it('is results (populated) with multiple matches, even when one of them is terminal', () => {
        const resolved = makeIngredient({ id: 'ing_1', foodResolutionStatus: FoodResolutionStatus.RESOLVED });
        const notFound = makeIngredient({ id: 'ing_2', foodResolutionStatus: FoodResolutionStatus.NOT_FOUND });
        const results = [resolved, notFound];

        expect(deriveViewState(baseInput({ trimmed: 'xy', searchIsSuccess: true, results }))).toEqual({
            kind: 'results',
            results,
            isSuccess: true,
            isError: false,
        });
    });

    it('is results with isError set when the search fails', () => {
        expect(deriveViewState(baseInput({ trimmed: 'oli', searchIsError: true }))).toEqual({
            kind: 'results',
            results: [],
            isSuccess: false,
            isError: true,
        });
    });

    it('is terminal when the search settles on exactly one match and it is a dead end (FR-007)', () => {
        const notFound = makeIngredient({
            id: 'ing_x',
            name: 'Mystery spice',
            foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
        });

        expect(deriveViewState(baseInput({ trimmed: 'mystery', searchIsSuccess: true, results: [notFound] }))).toEqual({
            kind: 'terminal',
            ingredient: notFound,
            status: FoodResolutionStatus.NOT_FOUND,
        });
    });

    it('is results (not terminal) for a single non-terminal match', () => {
        const resolved = makeIngredient({ id: 'ing_1', foodResolutionStatus: FoodResolutionStatus.RESOLVED });

        expect(deriveViewState(baseInput({ trimmed: 'oli', searchIsSuccess: true, results: [resolved] }))).toEqual({
            kind: 'results',
            results: [resolved],
            isSuccess: true,
            isError: false,
        });
    });

    it('is disambiguating while a match is being disambiguated and no resolve is in flight', () => {
        const disambiguating = makeIngredient({ id: 'ing_u', name: 'Quinoa' });

        expect(
            deriveViewState(
                baseInput({
                    disambiguating,
                    candidatesData: [CANDIDATE],
                    candidatesIsLoading: false,
                    candidatesIsError: false,
                }),
            ),
        ).toEqual({
            kind: 'disambiguating',
            name: 'Quinoa',
            isLoading: false,
            isError: false,
            candidates: [CANDIDATE],
        });
    });

    it('reports candidates loading/error sub-state while disambiguating', () => {
        const disambiguating = makeIngredient({ id: 'ing_u', name: 'Quinoa' });

        expect(deriveViewState(baseInput({ disambiguating, candidatesIsLoading: true }))).toEqual({
            kind: 'disambiguating',
            name: 'Quinoa',
            isLoading: true,
            isError: false,
            candidates: [],
        });
        expect(deriveViewState(baseInput({ disambiguating, candidatesIsError: true }))).toEqual({
            kind: 'disambiguating',
            name: 'Quinoa',
            isLoading: false,
            isError: true,
            candidates: [],
        });
    });

    it('is resolving (keeping the last-known candidates) while a candidate pick is in flight', () => {
        const disambiguating = makeIngredient({ id: 'ing_u', name: 'Quinoa' });

        expect(
            deriveViewState(baseInput({ disambiguating, candidatesData: [CANDIDATE], resolveIsPending: true })),
        ).toEqual({ kind: 'resolving', name: 'Quinoa', candidates: [CANDIDATE] });
    });

    it('disambiguating takes priority over an incidentally non-empty trimmed query', () => {
        const disambiguating = makeIngredient({ id: 'ing_u', name: 'Quinoa' });

        expect(deriveViewState(baseInput({ disambiguating, trimmed: 'quin', searchIsSuccess: true }))).toMatchObject({
            kind: 'disambiguating',
        });
    });
});

describe('meetsIngredientSearchThreshold (REQ-057 — 2-character trigger)', () => {
    it('is false below MIN_INGREDIENT_QUERY_LENGTH', () => {
        expect(MIN_INGREDIENT_QUERY_LENGTH).toBe(2);
        expect(meetsIngredientSearchThreshold('')).toBe(false);
        expect(meetsIngredientSearchThreshold('s')).toBe(false);
    });

    it('is true at and above MIN_INGREDIENT_QUERY_LENGTH', () => {
        expect(meetsIngredientSearchThreshold('sp')).toBe(true);
        expect(meetsIngredientSearchThreshold('spinach')).toBe(true);
    });
});

describe('rankIngredientResults (REQ-057 — prefix > substring > fuzzy, alphabetical ties)', () => {
    it('orders a prefix match before a substring match before a fuzzy (neither) match', () => {
        const prefix = makeIngredient({ id: 'ing_1', name: 'Apple pie spice' });
        const substring = makeIngredient({ id: 'ing_2', name: 'Pineapple' });
        const fuzzy = makeIngredient({ id: 'ing_3', name: 'Aplpe' });

        // Deliberately scrambled input order — the function must re-sort it, not merely preserve input order.
        const ranked = rankIngredientResults([substring, fuzzy, prefix], 'apple');

        expect(ranked.map((ingredient) => ingredient.id)).toEqual(['ing_1', 'ing_2', 'ing_3']);
    });

    it('is case-insensitive when classifying prefix/substring matches', () => {
        const prefix = makeIngredient({ id: 'ing_1', name: 'APPLE PIE' });
        const substring = makeIngredient({ id: 'ing_2', name: 'pineapple' });

        expect(rankIngredientResults([substring, prefix], 'Apple').map((ingredient) => ingredient.id)).toEqual([
            'ing_1',
            'ing_2',
        ]);
    });

    it('breaks ties within the same rank alphabetically by display name', () => {
        const zucchini = makeIngredient({ id: 'ing_z', name: 'Zucchini apple' }); // substring
        const banana = makeIngredient({ id: 'ing_b', name: 'Banana apple' }); // substring

        expect(rankIngredientResults([zucchini, banana], 'apple').map((ingredient) => ingredient.id)).toEqual([
            'ing_b',
            'ing_z',
        ]);
    });

    it('does not mutate the input array (pure)', () => {
        const results = [
            makeIngredient({ id: 'ing_2', name: 'Pineapple' }),
            makeIngredient({ id: 'ing_1', name: 'Apple' }),
        ];
        const original = [...results];

        rankIngredientResults(results, 'apple');

        expect(results).toEqual(original);
    });

    it('returns an empty array unchanged', () => {
        expect(rankIngredientResults([], 'apple')).toEqual([]);
    });
});
