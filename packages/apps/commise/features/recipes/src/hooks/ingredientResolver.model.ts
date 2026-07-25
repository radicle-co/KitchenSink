/**
 * Headless-hook seam (CP-6/P2) — pure state-and-transition model for {@link useIngredientResolver}. No
 * React, no client hooks: only the status classification, the branch decision, the view derivation, and the
 * projection from a catalog `Ingredient` onto a resolved recipe line. Kept in its own module so the pure
 * logic is unit-testable independent of the stateful hook that wraps it in React state + TanStack mutations.
 *
 * Extracted from the two near-identical `IngredientPicker` leaves (web
 * `web/src/components/recipes/IngredientPicker.tsx`, mobile `mobile/src/components/IngredientPicker.tsx`),
 * which duplicated this exact classification/projection logic — `isTerminalStatus`/`isUnresolvedStatus` were
 * named on web and inlined on mobile; CP-6 unifies both leaves on the named helpers here.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { IngredientCandidate } from '@kitchensink/recipe-service-client';

import type { RecipeFormIngredient } from '../form/model.js';

/** The minimum trimmed-query length that triggers an ingredient search (REQ-057). */
export const MIN_INGREDIENT_QUERY_LENGTH = 2;

/** The debounce window (ms) between a keystroke and the search it triggers (REQ-057). */
export const INGREDIENT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Whether a trimmed query is long enough to trigger the ingredient typeahead (REQ-057 — at least
 * {@link MIN_INGREDIENT_QUERY_LENGTH} characters). Pure.
 *
 * @param trimmed - The trimmed search-box query.
 * @returns `true` once the query meets the trigger threshold.
 */
export function meetsIngredientSearchThreshold(trimmed: string): boolean {
    return trimmed.length >= MIN_INGREDIENT_QUERY_LENGTH;
}

/** REQ-057's three match-quality buckets, in descending rank order (0 = best). */
const enum MatchRank {
    PREFIX = 0,
    SUBSTRING = 1,
    FUZZY = 2,
}

/** Classify one ingredient name's match quality against the (already lower-cased) query. Pure. */
function matchRank(name: string, lowerQuery: string): MatchRank {
    if (lowerQuery.length === 0) {
        return MatchRank.PREFIX;
    }

    const lowerName = name.toLowerCase();

    if (lowerName.startsWith(lowerQuery)) {
        return MatchRank.PREFIX;
    }

    if (lowerName.includes(lowerQuery)) {
        return MatchRank.SUBSTRING;
    }

    return MatchRank.FUZZY;
}

/**
 * Rank ingredient search results by match quality (REQ-057): a prefix match beats a substring match beats
 * everything else (a "fuzzy" match — whatever the backend's trigram/FTS search deemed relevant but that
 * does not literally contain the query), with ties broken alphabetically by display name. Returns a NEW
 * array — the input is never mutated. Pure.
 *
 * @param results - The unranked search results (in whatever order the backend returned them).
 * @param query - The raw search-box query the results were matched against.
 * @returns A new array, re-ordered per REQ-057.
 */
export function rankIngredientResults(results: readonly Ingredient[], query: string): Ingredient[] {
    const lowerQuery = query.toLowerCase();

    return [...results].sort((a, b) => {
        const rankDiff = matchRank(a.name, lowerQuery) - matchRank(b.name, lowerQuery);

        return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
    });
}

/** Whether a food resolution is terminal — no nutrition will ever arrive (FR-007). */
export function isTerminalStatus(status: FoodResolutionStatus | undefined): status is FoodResolutionStatus {
    return status === FoodResolutionStatus.NOT_FOUND || status === FoodResolutionStatus.FAILED;
}

/** Whether a match needs disambiguation (multiple candidate foods) before it can resolve (data-model R5). */
export function isUnresolvedStatus(status: FoodResolutionStatus | undefined): boolean {
    return status === FoodResolutionStatus.UNRESOLVED;
}

/**
 * The catalog-hit / addByName branch decision (data-model R5): an `UNRESOLVED` status always needs
 * disambiguation; every other status — `PENDING`, `RESOLVED`, and the terminal `NOT_FOUND`/`FAILED` — is
 * added immediately (a terminal status still resolves the line so its badge can surface the dead end; see
 * {@link isTerminalStatus} for the picker's separate "show a notice" concern). An absent status (a freeform
 * ingredient carries no status at all) also resolves immediately — there is nothing to disambiguate.
 *
 * @param status - The catalog match's current async resolution status, if any.
 * @returns `'disambiguate'` for `UNRESOLVED`, `'resolve'` for everything else (including `undefined`).
 */
export function nextMatchAction(status: FoodResolutionStatus | undefined): 'resolve' | 'disambiguate' {
    return isUnresolvedStatus(status) ? 'disambiguate' : 'resolve';
}

/**
 * Project a catalog `Ingredient` onto a resolved form line (quantity defaults to 1; the form edits it).
 *
 * Also carries the ingredient's per-100g macros + household-measure portions, when the catalog row has them,
 * onto the form line (w3/e3) — so a picked ingredient's nutrition survives to feed {@link toNutritionLine}
 * (`form/model.ts`) for step 2's per-row + running per-serving nutrition (FR-007). A line still `PENDING`
 * resolution, or a freeform ingredient with no catalog nutrition, carries none of these fields — never a
 * fabricated `0` — which is exactly the input {@link toNutritionLine}'s aggregator needs to correctly report
 * that line as unaccounted (`isComplete: false`) rather than silently under-counting.
 */
export function toIngredientLine(ingredient: Ingredient): RecipeFormIngredient {
    return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: 1,
        ...(ingredient.foodResolutionStatus === undefined ? {} : { resolutionStatus: ingredient.foodResolutionStatus }),
        ...(ingredient.caloriesPer100g === undefined ? {} : { caloriesPer100g: ingredient.caloriesPer100g }),
        ...(ingredient.proteinGPer100g === undefined ? {} : { proteinGPer100g: ingredient.proteinGPer100g }),
        ...(ingredient.carbsGPer100g === undefined ? {} : { carbsGPer100g: ingredient.carbsGPer100g }),
        ...(ingredient.fatGPer100g === undefined ? {} : { fatGPer100g: ingredient.fatGPer100g }),
        ...(ingredient.portions === undefined ? {} : { portions: ingredient.portions }),
    };
}

/** Pending/error flags for one of the resolver's underlying mutations, exposed to a leaf as plain data. */
export interface MutationView {
    readonly isPending: boolean;
    readonly isError: boolean;
}

/**
 * The picker's current view — a discriminated union so a leaf renders it with an exhaustive `switch`
 * instead of re-deriving the same implicit state machine from raw query/mutation flags. Kinds:
 *  - `idle` — no query typed yet, the query is below the {@link MIN_INGREDIENT_QUERY_LENGTH} search trigger
 *    (REQ-057), and nothing is being disambiguated.
 *  - `searching` — a query is in flight (no data yet).
 *  - `results` — the search settled (`isSuccess`/`isError`), with zero or more catalog matches. A per-row
 *    terminal notice (see {@link isTerminalStatus}) is the LEAF's concern — each row's own
 *    `foodResolutionStatus` carries that, so a mixed result set (some matches terminal, some not) renders
 *    correctly without a separate top-level state for it.
 *  - `terminal` — the search settled on EXACTLY ONE match and it is a dead end (`NOT_FOUND`/`FAILED`): the
 *    catalog has nothing more to offer for this query. Surfaced as its own explicit, unit-testable state
 *    (the extraction makes it first-class instead of an implicit per-row conditional) — the freeform
 *    fallback stays reachable exactly as it does from every other non-idle kind (FR-007, no dead ends).
 *  - `disambiguating` — a match needs a candidate pick; `candidates` reflects the current fetch's state.
 *  - `resolving` — a candidate pick is in flight; the last-known `candidates` are carried forward (not
 *    discarded) so a leaf can render them disabled instead of the panel collapsing mid-request.
 */
export type IngredientResolverViewState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'searching' }
    | {
          readonly kind: 'results';
          readonly results: readonly Ingredient[];
          readonly isSuccess: boolean;
          readonly isError: boolean;
      }
    | { readonly kind: 'terminal'; readonly ingredient: Ingredient; readonly status: FoodResolutionStatus }
    | {
          readonly kind: 'disambiguating';
          readonly name: string;
          readonly isLoading: boolean;
          readonly isError: boolean;
          readonly candidates: readonly IngredientCandidate[];
      }
    | { readonly kind: 'resolving'; readonly name: string; readonly candidates: readonly IngredientCandidate[] };

/** The raw query/mutation facts {@link deriveViewState} reduces to a single {@link IngredientResolverViewState}. */
export interface DeriveViewStateInput {
    readonly disambiguating: Ingredient | null;
    readonly trimmed: string;
    readonly results: readonly Ingredient[];
    readonly searchIsLoading: boolean;
    readonly searchIsSuccess: boolean;
    readonly searchIsError: boolean;
    readonly candidatesData: readonly IngredientCandidate[] | undefined;
    readonly candidatesIsLoading: boolean;
    readonly candidatesIsError: boolean;
    readonly resolveIsPending: boolean;
}

/**
 * Pure reduction of the resolver's raw TanStack query/mutation facts to one {@link IngredientResolverViewState}.
 * Disambiguation always takes priority over the search region (mirrors both leaves: the search box itself is
 * replaced by the disambiguation panel).
 *
 * @param input - The current search/candidates/resolve facts.
 * @returns The single view state a leaf renders.
 */
export function deriveViewState(input: DeriveViewStateInput): IngredientResolverViewState {
    const { disambiguating } = input;

    if (disambiguating !== null) {
        const candidates = input.candidatesData ?? [];

        if (input.resolveIsPending) {
            return { kind: 'resolving', name: disambiguating.name, candidates };
        }

        return {
            kind: 'disambiguating',
            name: disambiguating.name,
            isLoading: input.candidatesIsLoading,
            isError: input.candidatesIsError,
            candidates,
        };
    }

    if (!meetsIngredientSearchThreshold(input.trimmed)) {
        return { kind: 'idle' };
    }

    if (input.searchIsLoading) {
        return { kind: 'searching' };
    }

    const single = input.results.length === 1 ? input.results[0] : undefined;

    if (single !== undefined && isTerminalStatus(single.foodResolutionStatus)) {
        return { kind: 'terminal', ingredient: single, status: single.foodResolutionStatus };
    }

    return { kind: 'results', results: input.results, isSuccess: input.searchIsSuccess, isError: input.searchIsError };
}
