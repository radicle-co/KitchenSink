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
import type { IngredientCandidate, IngredientSuggestion } from '@kitchensink/recipe-service-client';
import { describe, expect, it } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import {
    deriveViewState,
    isTerminalStatus,
    isUnresolvedStatus,
    nextMatchAction,
    suggestionKey,
    suggestionName,
    toIngredientLine,
    type DeriveViewStateInput,
} from '../ingredientResolver.model.js';

/** Wrap one of the user's own catalog rows as a `local` blended suggestion. */
function local(ingredient: Ingredient): IngredientSuggestion {
    return { provenance: 'local', ingredient };
}

/** A food-catalog (not-yet-admitted) blended suggestion. */
function catalog(foodId: string, name: string, score = 0.9): IngredientSuggestion {
    return { provenance: 'catalog', foodId, name, score };
}

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
        suggestions: [],
        catalogAvailability: 'ok',
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
        // ⚠️ The needles moved from 'ab'/'a' to 'abc'/'ab' with plan U37: FR-010a raised the minimum to
        // three, so the OLD pair straddled nothing — both sides were below it and the case would have
        // asserted `searching` for a query that can never search. The invariant is unchanged.
        expect(
            deriveViewState(
                baseInput({
                    trimmed: 'abc',
                    debouncedTrimmed: 'ab', // still the PREVIOUS (sub-threshold) debounced value
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
                    suggestions: [local(stale)],
                }),
            ),
        ).toEqual({ kind: 'searching' });
    });

    it('is results (empty) once the debounce has genuinely settled and the search itself came back empty', () => {
        // `debouncedTrimmed` explicitly equals `trimmed` here (the debounce settled) — proves the fix does
        // not mask the REAL empty state, only the transient pending-debounce window above.
        expect(
            deriveViewState(
                baseInput({ trimmed: 'zzz', debouncedTrimmed: 'zzz', searchIsSuccess: true, suggestions: [] }),
            ),
        ).toEqual({ kind: 'results', suggestions: [], catalogAvailability: 'ok', isSuccess: true, isError: false });
    });

    it('is tooShort below the FR-010a minimum, even with a match already loaded', () => {
        // ⚠️ REWRITTEN for 003-FR-010a (plan U37), not weakened. It asserted `idle` at one character under
        // the retired 2-character client trigger. The invariant it protects is the valuable half and is
        // unchanged: a stale suggestion from a LONGER previous query must not be rendered as an answer to
        // the shorter one now in the box. What changed is that the cook is now TOLD why nothing is shown.
        const hit = makeIngredient({ id: 'ing_9', name: 'Salt' });

        expect(
            deriveViewState(
                baseInput({
                    trimmed: 's',
                    searchIsSuccess: true,
                    searchIsLoading: true,
                    suggestions: [local(hit)],
                }),
            ),
        ).toEqual({ kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH });
    });

    it('is results (empty) once the search settles with no matches', () => {
        expect(deriveViewState(baseInput({ trimmed: 'zzz', searchIsSuccess: true, suggestions: [] }))).toEqual({
            kind: 'results',
            suggestions: [],
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    it('is results (populated) with multiple matches, even when one of them is terminal', () => {
        const resolved = makeIngredient({ id: 'ing_1', foodResolutionStatus: FoodResolutionStatus.RESOLVED });
        const notFound = makeIngredient({ id: 'ing_2', foodResolutionStatus: FoodResolutionStatus.NOT_FOUND });
        const suggestions = [local(resolved), local(notFound)];

        expect(deriveViewState(baseInput({ trimmed: 'xyz', searchIsSuccess: true, suggestions }))).toEqual({
            kind: 'results',
            suggestions,
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    it('is results with isError set when the search fails', () => {
        expect(deriveViewState(baseInput({ trimmed: 'oli', searchIsError: true }))).toEqual({
            kind: 'results',
            suggestions: [],
            catalogAvailability: 'ok',
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

        expect(
            deriveViewState(baseInput({ trimmed: 'mystery', searchIsSuccess: true, suggestions: [local(notFound)] })),
        ).toEqual({
            kind: 'terminal',
            ingredient: notFound,
            status: FoodResolutionStatus.NOT_FOUND,
        });
    });

    it('is results (not terminal) for a single non-terminal match', () => {
        const resolved = makeIngredient({ id: 'ing_1', foodResolutionStatus: FoodResolutionStatus.RESOLVED });

        expect(
            deriveViewState(baseInput({ trimmed: 'oli', searchIsSuccess: true, suggestions: [local(resolved)] })),
        ).toEqual({
            kind: 'results',
            suggestions: [local(resolved)],
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    // ── Search Stage 2 — the blended-suggestion states ───────────────────────────────────────────────

    it('is results carrying BOTH sections, in the order given (local first, never interleaved)', () => {
        const mine = makeIngredient({ id: 'ing_1', name: 'My chicken' });
        const suggestions = [local(mine), catalog('01J0FOOD', 'Chicken breast, raw', 0.99)];

        expect(deriveViewState(baseInput({ trimmed: 'chick', searchIsSuccess: true, suggestions }))).toEqual({
            kind: 'results',
            suggestions,
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    it('carries a degraded catalog through as `unavailable` WITHOUT suppressing the local section (F2)', () => {
        const mine = makeIngredient({ id: 'ing_1', name: 'My chicken' });

        expect(
            deriveViewState(
                baseInput({
                    trimmed: 'chick',
                    searchIsSuccess: true,
                    suggestions: [local(mine)],
                    catalogAvailability: 'unavailable',
                }),
            ),
        ).toEqual({
            kind: 'results',
            suggestions: [local(mine)],
            catalogAvailability: 'unavailable',
            isSuccess: true,
            isError: false,
        });
    });

    it('carries `disabled` through distinctly from `unavailable` (an operator switch is not an error)', () => {
        const state = deriveViewState(
            baseInput({ trimmed: 'chick', searchIsSuccess: true, catalogAvailability: 'disabled' }),
        );

        expect(state.kind === 'results' ? state.catalogAvailability : undefined).toBe('disabled');
    });

    it('is NEVER terminal for a lone CATALOG hit — a golden record has nutrition, not a dead end', () => {
        // A catalog suggestion has no `foodResolutionStatus` at all; collapsing to `terminal` here would tell
        // the user "no nutrition match" about the one row that definitely HAS nutrition.
        const suggestions = [catalog('01J0FOOD', 'Chicken breast, raw')];

        expect(deriveViewState(baseInput({ trimmed: 'chick', searchIsSuccess: true, suggestions }))).toEqual({
            kind: 'results',
            suggestions,
            catalogAvailability: 'ok',
            isSuccess: true,
            isError: false,
        });
    });

    it('is NOT terminal when a lone terminal local row is joined by a catalog hit (more IS on offer)', () => {
        const notFound = makeIngredient({ id: 'ing_x', foodResolutionStatus: FoodResolutionStatus.NOT_FOUND });
        const suggestions = [local(notFound), catalog('01J0FOOD', 'Chicken breast, raw')];

        expect(deriveViewState(baseInput({ trimmed: 'chick', searchIsSuccess: true, suggestions })).kind).toBe(
            'results',
        );
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

/**
 * The FR-010a minimum, seen from the PICKER (plan U37).
 *
 * ⚠️ **REPLACES `describe('meetsIngredientSearchThreshold (REQ-057 — 2-character trigger)')`.** That block
 * asserted a client-only constant of 2 that this package OWNED. Both are gone: the number is now
 * `MIN_SEARCH_QUERY_LENGTH` in `@kitchensink/recipe-core/resolution/search-minimum` (its own unit suite
 * pins the value and the trimming), and the predicate is that module's. What is left to assert HERE is the
 * only thing this package still decides — which VIEW STATE a below-minimum query produces — and that is a
 * genuinely new obligation, because FR-010a requires the cook to be TOLD rather than shown nothing.
 *
 * ⛔ `idle` and `tooShort` must stay distinct kinds. Collapsing them would either put "type at least three
 * characters" over an untouched search box (noise, every time the picker opens) or drop the explanation
 * entirely, which is the FR-010a behaviour this unit exists to add.
 */
describe('deriveViewState — the FR-010a minimum (003-FR-010a, plan U37)', () => {
    it('is idle for an untouched box, where there is nothing to explain', () => {
        expect(deriveViewState(baseInput({ trimmed: '' }))).toEqual({ kind: 'idle' });
    });

    it.each(['e', 'eg'])('is tooShort for the below-minimum query %j', (trimmed) => {
        expect(deriveViewState(baseInput({ trimmed }))).toEqual({ kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH });
    });

    it('carries the minimum on the state, so the copy cannot disagree with the gate', () => {
        // The leaves interpolate this into the localized message. Sourcing it from the state (which reads
        // the shared constant) rather than from a literal in the dictionary is what keeps the sentence
        // "type at least N characters" true when N moves — and what makes the number the SERVER enforces
        // the number the cook is shown.
        expect(deriveViewState(baseInput({ trimmed: 'e' }))).toMatchObject({ minimum: MIN_SEARCH_QUERY_LENGTH });
        expect(MIN_SEARCH_QUERY_LENGTH).toBe(3);
    });

    it('searches at the minimum — the three-character foods are not casualties', () => {
        expect(deriveViewState(baseInput({ trimmed: 'egg', searchIsSuccess: true }))).toMatchObject({
            kind: 'results',
        });
    });

    it('is tooShort even mid-debounce, so the searching spinner never appears for a query that cannot run', () => {
        // `trimmed !== debouncedTrimmed` normally means `searching`. Below the minimum no request will ever
        // be issued, so a spinner there would promise a result that is not coming.
        expect(deriveViewState(baseInput({ trimmed: 'eg', debouncedTrimmed: 'e' }))).toEqual({
            kind: 'tooShort',
            minimum: MIN_SEARCH_QUERY_LENGTH,
        });
    });

    it('still lets disambiguation take priority over a below-minimum query', () => {
        const disambiguating = makeIngredient({ id: 'ing_u', name: 'Quinoa' });

        expect(deriveViewState(baseInput({ disambiguating, trimmed: 'eg' }))).toMatchObject({
            kind: 'disambiguating',
        });
    });
});

/**
 * ⛔ **DELETED IN PLAN U5: `rankIngredientResults` and `rankIngredientSuggestions`.**
 *
 * Two `describe` blocks lived here — 13 cases pinning `PREFIX > SUBSTRING > FUZZY`, alphabetical ties,
 * purity, and per-section ranking. They are gone because the functions they covered are gone, not because
 * they were failing. Owner ruling 2026-08-20: the server determines order, on best-quality match.
 *
 * **Where the coverage went**, in full:
 *
 *  - *Ordering by match quality* → the two Scoring Policies' tier ladder, asserted against a REAL Postgres
 *    by `recipe-service/__tests__/integration/ingredients/ingredientRanking.integration.test.ts` and
 *    `food-service/tests/rankingTiers.integration.test.ts`, and as a truth table by
 *    `recipe-core/src/resolution/__tests__/rankingTiers.test.ts`.
 *  - *Deterministic tie-breaking* → `compareTieredHits` plus each statement's `ORDER BY score DESC,
 *    name ASC`, and the conformance contract's determinism case in
 *    `@kitchensink/service-test-harness`.
 *  - *Cross-implementation agreement* → `registerRankingConformance`, run by BOTH surfaces.
 *  - *The picker rendering that order untouched* → the two rewritten cases in
 *    `useIngredientResolver.test.tsx` and the pass-through case in `useIngredientFilterSearch.test.tsx`.
 *
 * The `local`-before-`catalog` SECTIONING those blocks also asserted was never this module's: it is a
 * property of the server's blend (`ingredientSuggestion.ts`), covered by
 * `recipe-service/__tests__/integration/ingredients/blendedSuggest.integration.test.ts`.
 */

describe('suggestionName / suggestionKey (search Stage 2)', () => {
    it('reads the display name from whichever provenance the suggestion has', () => {
        expect(suggestionName(local(makeIngredient({ id: 'ing_1', name: 'My apple' })))).toBe('My apple');
        expect(suggestionName(catalog('01J0FOOD', 'Apples, raw'))).toBe('Apples, raw');
    });

    it('namespaces the key by provenance so the two unrelated id spaces cannot collide', () => {
        // Same underlying id string in both spaces: unprefixed keys would make React reuse one row for the
        // other, carrying over its DOM state.
        const collidingId = 'same-id';

        expect(suggestionKey(local(makeIngredient({ id: collidingId })))).not.toBe(
            suggestionKey(catalog(collidingId, 'Apples, raw')),
        );
    });

    it('keys are stable for the same suggestion', () => {
        const suggestion = catalog('01J0FOOD', 'Apples, raw');

        expect(suggestionKey(suggestion)).toBe(suggestionKey(suggestion));
    });
});
