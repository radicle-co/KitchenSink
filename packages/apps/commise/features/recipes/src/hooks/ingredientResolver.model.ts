/**
 * Headless-hook seam (CP-6/P2) — pure state-and-transition model for `useIngredientResolver`. No
 * React, no client hooks: only the status classification, the branch decision, the view derivation, and the
 * projection from a catalog `Ingredient` onto a resolved recipe line. Kept in its own module so the pure
 * logic is unit-testable independent of the stateful hook that wraps it in React state + TanStack mutations.
 *
 * Extracted from the two near-identical `IngredientPicker` leaves (web
 * `web/src/components/recipes/IngredientPicker.tsx`, mobile `mobile/src/components/IngredientPicker.tsx`),
 * which duplicated this exact classification/projection logic — `isTerminalStatus`/`isUnresolvedStatus` were
 * named on web and inlined on mobile; CP-6 unifies both leaves on the named helpers here.
 *
 * ⛔ **RETIRED IN PLAN U5 — do not restore.** `rankIngredientResults` and `rankIngredientSuggestions` used
 * to re-sort the server's page here by `PREFIX > SUBSTRING > FUZZY`, together with the `MatchRank` bucket
 * classifier behind them.
 *
 * **Owner ruling (2026-08-20): the server determines order, on best-quality match.** REQ-057's INTENT —
 * best match first — is preserved and better served; what was retired is its MECHANISM, a client-side
 * heuristic that approximated relevance from string shape rather than scoring it. Three reasons it had to
 * go, not one:
 *
 *  1. **It could only ever reorder a page the broken sort key had already selected.** The server truncates
 *     before the client sees anything — the local table at `DEFAULT_SEARCH_LIMIT = 10`, the catalog at
 *     `SEARCH_LIMIT = 20` — so a row the server ranked out of the page was unreachable here whatever this
 *     function did.
 *  2. **The IMPORTER never ran it.** It reads `suggestions[0]` straight off the API, so the measurement the
 *     whole plan is denominated in (~900 of 2,432 lines carrying a wrong `food_id`) was taken against the
 *     SERVER's order. Two rankers meant the product and its own measurement disagreed about every query.
 *  3. **It masked the defect rather than fixing it.** Re-ranking within each provenance section preserved
 *     `local` before `catalog`, so a wrong `local` suggestion still outranked a correct `catalog` one
 *     regardless of match quality — while making the single-token cases look fine in the picker.
 *
 * ⚠️ **The sectioning is NOT retired with it**, and it never lived here: `IngredientSuggestion`'s blend on
 * the server orders `[local text hits] -> [promoted rows] -> [catalog hits]`, and this module now renders
 * that order untouched. The replacement ranking lives in the two Scoring Policies
 * (`food-service/src/foods/dao/foodRelevance.ts`, `recipe-service/src/ingredients/dal/ingredientRelevance.ts`)
 * over the shared ladder in `@kitchensink/recipe-core/resolution/ranking-tiers`, and is proven against a
 * real database by each service's ranking integration suite plus the shared conformance contract.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import type {
    IngredientCandidate,
    IngredientCatalogAvailability,
    IngredientSuggestion,
} from '@kitchensink/recipe-service-client';

import type { RecipeFormIngredient } from '../form/model.js';

/** The debounce window (ms) between a keystroke and the search it triggers (REQ-057). */
export const INGREDIENT_SEARCH_DEBOUNCE_MS = 300;

/*
 * ⛔ `MIN_INGREDIENT_QUERY_LENGTH` (2) and `meetsIngredientSearchThreshold` USED TO LIVE HERE, and were
 * this package's own. They are DELETED, not renamed: 003-FR-010a (owner ruling 2026-08-24, plan U37)
 * raised the floor to three characters and made it a rule the SERVER enforces too, so a client-owned copy
 * of the number is a second authority that can only ever drift. Both surfaces now read
 * `MIN_SEARCH_QUERY_LENGTH` / `meetsSearchMinimum` from
 * `@kitchensink/recipe-core/resolution/search-minimum`, which food-service's DAO and service read as well.
 *
 * ⚠️ The DEBOUNCE stays local. It is a client-only interaction concern with no server counterpart, and it
 * changes for entirely different reasons than the minimum does — merging the two would be DRY applied to
 * keystrokes rather than to knowledge.
 */

/** The display name of a blended suggestion, whichever provenance it has. Pure. */
export function suggestionName(suggestion: IngredientSuggestion): string {
    return suggestion.provenance === 'local' ? suggestion.ingredient.name : suggestion.name;
}

/**
 * A stable, collision-free React key for a blended suggestion. Pure.
 *
 * Prefixed by provenance because the two id spaces are unrelated — an `ingredients` UUID and an opaque food
 * id could in principle coincide, and an unprefixed key would then make React reuse one row's DOM/state for
 * the other.
 *
 * @param suggestion - The suggestion to key.
 * @returns A key unique within one blended result set.
 */
export function suggestionKey(suggestion: IngredientSuggestion): string {
    return suggestion.provenance === 'local' ? `local:${suggestion.ingredient.id}` : `catalog:${suggestion.foodId}`;
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
 * onto the form line (w3/e3) — so a picked ingredient's nutrition survives to feed `toNutritionLine`
 * (`form/model.ts`) for step 2's per-row + running per-serving nutrition (FR-007). A line still `PENDING`
 * resolution, or a freeform ingredient with no catalog nutrition, carries none of these fields — never a
 * fabricated `0` — which is exactly the input `toNutritionLine`'s aggregator needs to correctly report
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
 *  - `idle` — no query typed yet (and nothing is being disambiguated). The search box is untouched, so
 *    there is nothing to say about it.
 *  - `tooShort` — something is typed, but fewer than {@link MIN_SEARCH_QUERY_LENGTH} characters
 *    (003-FR-010a). ⛔ DISTINCT FROM `idle` on purpose: collapsing the two either puts "type at least three
 *    characters" over an untouched box on every open, or drops the explanation and leaves the cook typing
 *    into a surface that silently does nothing. FR-010a requires the cook to be TOLD. `minimum` rides on
 *    the state rather than being re-derived by each leaf, so the sentence and the gate cannot disagree.
 *  - `searching` — a query is in flight (no data yet), OR `trimmed` has crossed the search threshold but
 *    the debounced query gating the fetch (REQ-057, ~300ms behind keystrokes) hasn't caught up to it yet
 *    — see {@link DeriveViewStateInput.debouncedTrimmed}. Without this second half, the instant `trimmed`
 *    crosses the threshold the TanStack query is still `enabled: false` (its own `isLoading` is `false`,
 *    NOT because the search returned zero results but because it hasn't started yet), and this function
 *    would fall through to an empty `results` — flashing the "no matches, create one" affordance for the
 *    whole debounce window before the search has even fired (a regression this state was added to close).
 *  - `results` — the search settled (`isSuccess`/`isError`), with zero or more BLENDED suggestions (search
 *    Stage 2): the user's own `ingredients` rows and food-catalog hits, sectioned by provenance. A per-row
 *    terminal notice (see {@link isTerminalStatus}) is the LEAF's concern — each local row's own
 *    `foodResolutionStatus` carries that, so a mixed result set (some matches terminal, some not) renders
 *    correctly without a separate top-level state for it. `catalogAvailability` rides along so a leaf can
 *    tell the user the food catalog is degraded (F2) instead of silently showing a shorter list.
 *  - `terminal` — the search settled on EXACTLY ONE suggestion, it is one of the user's own rows, and it is a
 *    dead end (`NOT_FOUND`/`FAILED`): nothing on offer for this query. Surfaced as its own explicit,
 *    unit-testable state (the extraction makes it first-class instead of an implicit per-row conditional) —
 *    the freeform fallback stays reachable exactly as it does from every other non-idle kind (FR-007, no dead
 *    ends). A lone CATALOG hit can never be terminal: a catalog suggestion is a `RESOLVED` golden record by
 *    construction, so collapsing to this state for one would tell the user "no nutrition match" about the
 *    very row that has nutrition.
 *  - `disambiguating` — a match needs a candidate pick; `candidates` reflects the current fetch's state.
 *  - `resolving` — a candidate pick is in flight; the last-known `candidates` are carried forward (not
 *    discarded) so a leaf can render them disabled instead of the panel collapsing mid-request.
 */
export type IngredientResolverViewState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'tooShort'; readonly minimum: number }
    | { readonly kind: 'searching' }
    | {
          readonly kind: 'results';
          /** The blended suggestions, sectioned: every `local` precedes every `catalog`. */
          readonly suggestions: readonly IngredientSuggestion[];
          /** Whether the food catalog contributed (F2) — `unavailable` warrants a non-blocking notice. */
          readonly catalogAvailability: IngredientCatalogAvailability;
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
    /**
     * The debounced query (REQ-057, ~300ms behind `trimmed`) that actually gates the TanStack search
     * fetch's `enabled`. Distinct from `trimmed` so this function can tell "waiting for the debounce to
     * settle" (`trimmed !== debouncedTrimmed`) apart from "searched, zero results" (settled, and the
     * search itself came back empty) — see the `searching` kind's doc on {@link IngredientResolverViewState}.
     */
    readonly debouncedTrimmed: string;
    /** The blended suggestions, in the SERVER's order (sectioned `local` before `catalog`, U5). */
    readonly suggestions: readonly IngredientSuggestion[];
    /** Whether the food catalog contributed to this blend (F2). */
    readonly catalogAvailability: IngredientCatalogAvailability;
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

    // ⛔ The minimum is checked BEFORE the debounce window, not after. `trimmed !== debouncedTrimmed`
    // normally means `searching`, but below the minimum no request will ever be issued — so falling through
    // to `searching` would spin a promise that is never kept, on every one of the first two keystrokes.
    if (!meetsSearchMinimum(input.trimmed)) {
        return input.trimmed.length === 0 ? { kind: 'idle' } : { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH };
    }

    // REQ-057 debounce-flash fix: `trimmed` can cross the search threshold before `debouncedTrimmed` (and
    // therefore the TanStack query's `enabled`) catches up to it — that "waiting to search" window is
    // `searching` too, not a fall-through to empty `results` (see the kind's doc for the failure this
    // closes).
    if (input.searchIsLoading || input.trimmed !== input.debouncedTrimmed) {
        return { kind: 'searching' };
    }

    const single = input.suggestions.length === 1 ? input.suggestions[0] : undefined;

    // A lone dead-end row of the user's OWN. A lone catalog hit is never terminal (see the kind's doc).
    if (single?.provenance === 'local' && isTerminalStatus(single.ingredient.foodResolutionStatus)) {
        return { kind: 'terminal', ingredient: single.ingredient, status: single.ingredient.foodResolutionStatus };
    }

    return {
        kind: 'results',
        suggestions: input.suggestions,
        catalogAvailability: input.catalogAvailability,
        isSuccess: input.searchIsSuccess,
        isError: input.searchIsError,
    };
}
