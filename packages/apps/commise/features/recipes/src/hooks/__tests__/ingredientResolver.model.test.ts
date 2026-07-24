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
    nextMatchAction,
    toIngredientLine,
    type DeriveViewStateInput,
} from '../ingredientResolver.model.js';

/** A complete `deriveViewState` input with every field at its "nothing happening" default, overridable. */
function baseInput(overrides: Partial<DeriveViewStateInput> = {}): DeriveViewStateInput {
    return {
        disambiguating: null,
        trimmed: '',
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
});

describe('deriveViewState', () => {
    it('is idle when the query is blank and nothing is being disambiguated', () => {
        expect(deriveViewState(baseInput())).toEqual({ kind: 'idle' });
    });

    it('is searching while the search is in flight', () => {
        expect(deriveViewState(baseInput({ trimmed: 'oli', searchIsLoading: true }))).toEqual({ kind: 'searching' });
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

        expect(deriveViewState(baseInput({ trimmed: 'x', searchIsSuccess: true, results }))).toEqual({
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
