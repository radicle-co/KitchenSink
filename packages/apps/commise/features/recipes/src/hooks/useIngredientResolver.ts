/**
 * Headless-hook seam (CP-6/P2) — the shared ingredient-resolution state machine extracted from the two
 * near-identical `IngredientPicker` leaves (web `web/src/components/recipes/IngredientPicker.tsx`, mobile
 * `mobile/src/components/IngredientPicker.tsx`). Owns the search-box text and which match (if any) is being
 * disambiguated, and drives the four ways a line can resolve to a real catalog `ingredientId` (data-model
 * R5 / FR-007):
 *
 *  1. **suggestion pick** (`selectSuggestion`) — clicking a row in the BLENDED result list (search Stage 2).
 *     Dispatches on provenance: one of the user's own `ingredients` rows resolves through `selectMatch` (an
 *     `UNRESOLVED` one opens disambiguation — {@link nextMatchAction}); a food-CATALOG hit is first ADMITTED
 *     (`POST /v1/ingredients/by-food`, which creates the row and backfills its nutrition in one round-trip)
 *     and the line resolves from that response.
 *  2. **addByName** (`findNutrition`, the PRIMARY entry point for a typed name NOT in the list) — adds the food
 *     by name through the source-agnostic food service; routes by the returned status like a catalog-hit.
 *  3. **candidate** (`pickCandidate`) — resolves the disambiguated match from a chosen candidate.
 *  4. **freeform** (`addFreeform`, the explicit FALLBACK) — creates a plain user-entered ingredient with no
 *     food resolution. Reachable from every non-idle `viewState` — there is no dead end.
 *
 * All four converge on one `resolveLine`, which reports the resolved `RecipeFormIngredient` via the
 * caller's `onResolved` and resets the picker to a blank search.
 *
 * **Search Stage 2 (blended typeahead).** The search read is `useSuggestIngredients`
 * (`GET /v1/ingredients/suggest`), which returns a discriminated `local | catalog` union sectioned by
 * provenance plus a `catalogAvailability` flag. The local-only `useSearchIngredients` deliberately stays with
 * the recipe-SEARCH ingredient filter (`useIngredientFilterSearch`), whose result ids are filter values — a
 * food with no `ingredients` row could match no recipe there. The endpoint degrades to local-only rather than
 * failing when the food catalog is slow/down, so a degraded catalog arrives as a SUCCESS whose
 * `catalogAvailability` is `'unavailable'`, never as `isError` (F2).
 *
 * **Unifies three platform drifts** (see `.superpowers/sdd/cp6-current-state.md` §3):
 *  1. **Callback contract.** Web's `onSelect: (line: RecipeFormIngredient) => void` and mobile's
 *     `onResolve: (ingredient: ResolvedIngredient) => void` were two shapes for the same event. The hook
 *     standardizes on ONE contract — `onResolved: (line: RecipeFormIngredient) => void` — and each leaf
 *     adapts at its own boundary (mobile's leaf keeps its public `onResolve` prop and narrows the line down
 *     to the `ResolvedIngredient` shape its own callers expect).
 *  2. **Mutation-reset on resolve.** Web called `.reset()` on `addIngredientByName`/`createIngredient`/
 *     `resolveIngredient` after resolving; mobile argued this was redundant because leaving disambiguation
 *     unmounts the candidate panel. That argument doesn't hold: the mutations are declared at the TOP of
 *     the component (now: inside this hook), not inside the conditionally-rendered candidate panel, so
 *     their `isPending`/`isError` state survives a `disambiguating → null` transition regardless of what
 *     JSX happens to be mounted. Without an explicit reset, a stale `resolveIngredient.isError` from a
 *     previous failed pick would flash the next time disambiguation reopens, before any new pick has run.
 *     This hook adopts web's approach — `resolveLine` resets all three mutations, and `cancelDisambiguation`
 *     resets `resolveIngredient` too — closing that latent bug on mobile as a side effect of the extraction.
 *  3. **Named status helpers.** Web named `isTerminalStatus`/`isUnresolvedStatus`; mobile inlined the
 *     `FoodResolutionStatus.UNRESOLVED` check. Both leaves now consume the shared, unit-tested helpers from
 *     `./ingredientResolver.model.js` via `nextMatchAction`.
 *
 * Platform-agnostic: no DOM/React Native imports. `viewState` is a discriminated union
 * ({@link IngredientResolverViewState}) so each leaf renders it with an exhaustive `switch` instead of
 * re-deriving the state machine from raw TanStack query/mutation flags — see that type's doc for the exact
 * kinds and what each carries.
 */
import type { Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByFood,
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useResolveIngredient,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import type { IngredientSuggestion } from '@kitchensink/recipe-service-client';
import { useState } from 'react';

import type { RecipeFormIngredient } from '../form/model.js';

import {
    deriveViewState,
    INGREDIENT_SEARCH_DEBOUNCE_MS,
    meetsIngredientSearchThreshold,
    nextMatchAction,
    rankIngredientSuggestions,
    toIngredientLine,
} from './ingredientResolver.model.js';
import type { IngredientResolverViewState, MutationView } from './ingredientResolver.model.js';
import { useDebouncedValue } from './useDebouncedValue.js';

/** The state + actions {@link useIngredientResolver} exposes to a leaf. */
export interface UseIngredientResolverResult {
    /** The controlled search-box text (raw, untrimmed — what the leaf binds its input to). */
    readonly query: string;
    /** Update the search-box text. */
    readonly setQuery: (query: string) => void;
    /** The trimmed query — what actually drives search/addByName/freeform. */
    readonly trimmed: string;
    /** The current picker view. See {@link IngredientResolverViewState} for the exact kinds. */
    readonly viewState: IngredientResolverViewState;
    /** `addIngredientByName`'s pending/error flags — relevant outside disambiguation. */
    readonly addByNameStatus: MutationView;
    /**
     * `addIngredientByFood`'s pending/error flags — the Stage-2 catalog pick's admit round-trip. Distinct
     * from {@link addByNameStatus} so a leaf can show the pick's own busy/failed state on the row the user
     * actually tapped, instead of lighting up the unrelated "Find nutrition" action.
     */
    readonly addByFoodStatus: MutationView;
    /** `createIngredient`'s (freeform) pending/error flags — relevant in both search and disambiguation. */
    readonly createStatus: MutationView;
    /** `resolveIngredient`'s error flag — relevant only within disambiguation (pending is `viewState.kind === 'resolving'`). */
    readonly resolveError: boolean;
    /**
     * Pick a blended suggestion (search Stage 2) — the ONE action a result row wires. Dispatches on
     * provenance: one of the user's own rows goes straight through {@link selectMatch}; a food-catalog hit is
     * first ADMITTED into the catalog (`POST /v1/ingredients/by-food`, which also backfills its nutrition)
     * and only then resolves the line.
     */
    readonly selectSuggestion: (suggestion: IngredientSuggestion) => void;
    /**
     * Catalog-hit: an `UNRESOLVED` match opens disambiguation; anything else resolves immediately. Still
     * exported because the `terminal` view state carries a bare `Ingredient` (not a suggestion) — prefer
     * {@link selectSuggestion} for a row in the blended result list.
     */
    readonly selectMatch: (ingredient: Ingredient) => void;
    /** addByName — the PRIMARY entry point for a typed name (data-model R5 / FR-007). */
    readonly findNutrition: () => void;
    /** Resolve the disambiguated match from a chosen candidate. */
    readonly pickCandidate: (candidateId: string) => void;
    /** The explicit FALLBACK: create a plain user-entered ingredient with no food resolution. */
    readonly addFreeform: () => void;
    /** Leave disambiguation and return to search, discarding any stale resolve-error state. */
    readonly cancelDisambiguation: () => void;
}

/**
 * The shared ingredient-resolution state machine.
 *
 * @param onResolved - Called with a fully-resolved recipe line (its `ingredientId` set) to append.
 * @returns The search/disambiguation view state plus the actions that drive it.
 */
export function useIngredientResolver(onResolved: (line: RecipeFormIngredient) => void): UseIngredientResolverResult {
    const [query, setQuery] = useState('');
    const [disambiguating, setDisambiguating] = useState<Ingredient | null>(null);
    const trimmed = query.trim();
    // REQ-057: debounce the search-triggering query ~300ms behind keystrokes, and never search below the
    // 2-character trigger — `trimmed` (not debounced) still drives every other UI transition (labels,
    // idle/terminal state) so those react to every keystroke instantly.
    const debouncedTrimmed = useDebouncedValue(trimmed, INGREDIENT_SEARCH_DEBOUNCE_MS);

    // Search Stage 2: the BLENDED read (local `ingredients` + the food-service golden catalog), not the
    // local-only `/search` — that one stays the recipe-SEARCH filter's read, where a not-yet-admitted food
    // would be a meaningless filter value.
    const search = useSuggestIngredients(debouncedTrimmed, undefined, {
        enabled: disambiguating === null && meetsIngredientSearchThreshold(debouncedTrimmed),
    });
    const addIngredientByName = useAddIngredientByName();
    const addIngredientByFood = useAddIngredientByFood();
    const createIngredient = useCreateIngredient();
    const candidates = useIngredientCandidates(disambiguating?.id ?? '', { enabled: disambiguating !== null });
    const resolveIngredient = useResolveIngredient();

    // REQ-057: re-rank each provenance section by match quality (prefix > substring > fuzzy) so the picker's
    // order is deterministic regardless of either catalog's own ordering — WITHIN sections, never across them.
    const suggestions = rankIngredientSuggestions(search.data?.suggestions ?? [], trimmed);

    /** Append a resolved line and reset the picker back to a blank search (drift #2 — see module doc). */
    const resolveLine = (ingredient: Ingredient): void => {
        onResolved(toIngredientLine(ingredient));
        setQuery('');
        setDisambiguating(null);
        addIngredientByName.reset();
        addIngredientByFood.reset();
        createIngredient.reset();
        resolveIngredient.reset();
    };

    /** Handle a search-result click: an `UNRESOLVED` match opens disambiguation; anything else resolves now. */
    const selectMatch = (ingredient: Ingredient): void => {
        if (nextMatchAction(ingredient.foodResolutionStatus) === 'disambiguate') {
            setDisambiguating(ingredient);

            return;
        }

        resolveLine(ingredient);
    };

    /**
     * Pick a blended suggestion (search Stage 2). Dispatches on provenance — the whole reason the wire shape
     * is a discriminated union:
     *  - `local` — a real `ingredients` row; hand it straight to {@link selectMatch} (no round-trip).
     *  - `catalog` — a golden record with no `ingredients` row yet, so it MUST be admitted first. The server
     *    creates the row and backfills its nutrition in one request; the resolved ingredient it returns is
     *    what goes on the line (which is why we resolve from the RESPONSE, not from the suggestion — the
     *    suggestion carries no ingredient id and no nutrition). Its status still routes through
     *    {@link nextMatchAction}, so the rare not-yet-`RESOLVED` food opens disambiguation instead of
     *    silently landing a nutrition-less line. On failure the freeform fallback stays available.
     */
    const selectSuggestion = (suggestion: IngredientSuggestion): void => {
        if (suggestion.provenance === 'local') {
            selectMatch(suggestion.ingredient);

            return;
        }

        addIngredientByFood.mutate(suggestion.foodId, {
            onSuccess: (ingredient) => {
                if (nextMatchAction(ingredient.foodResolutionStatus) === 'disambiguate') {
                    setDisambiguating(ingredient);

                    return;
                }

                resolveLine(ingredient);
            },
        });
    };

    /**
     * The PRIMARY add action for a typed name (the async-resolution entry point): add the food by name and
     * route by the status it comes back with. On failure the freeform fallback stays available.
     */
    const findNutrition = (): void => {
        addIngredientByName.mutate(trimmed, {
            onSuccess: (ingredient) => {
                if (nextMatchAction(ingredient.foodResolutionStatus) === 'disambiguate') {
                    setDisambiguating(ingredient);

                    return;
                }

                resolveLine(ingredient);
            },
        });
    };

    /** Pick a disambiguation candidate: resolve the food, then append the now-`RESOLVED` line. */
    const pickCandidate = (candidateId: string): void => {
        if (disambiguating === null) {
            return;
        }

        resolveIngredient.mutate({ id: disambiguating.id, candidateIds: [candidateId] }, { onSuccess: resolveLine });
    };

    /** The explicit FALLBACK: a plain user-entered ingredient with no food resolution. Always available. */
    const addFreeform = (): void => {
        createIngredient.mutate(trimmed, { onSuccess: resolveLine });
    };

    /** Leave disambiguation without resolving — discards any stale resolve-error state (drift #2). */
    const cancelDisambiguation = (): void => {
        setDisambiguating(null);
        resolveIngredient.reset();
    };

    const viewState = deriveViewState({
        disambiguating,
        trimmed,
        debouncedTrimmed,
        suggestions,
        // Absent data (still loading, or the query is below the trigger) is NOT a degraded catalog — default
        // to `ok` so the picker never flashes a "catalog unavailable" notice before the first response lands.
        catalogAvailability: search.data?.catalogAvailability ?? 'ok',
        searchIsLoading: search.isLoading,
        searchIsSuccess: search.isSuccess,
        searchIsError: search.isError,
        candidatesData: candidates.data,
        candidatesIsLoading: candidates.isLoading,
        candidatesIsError: candidates.isError,
        resolveIsPending: resolveIngredient.isPending,
    });

    return {
        query,
        setQuery,
        trimmed,
        viewState,
        addByNameStatus: { isPending: addIngredientByName.isPending, isError: addIngredientByName.isError },
        addByFoodStatus: { isPending: addIngredientByFood.isPending, isError: addIngredientByFood.isError },
        createStatus: { isPending: createIngredient.isPending, isError: createIngredient.isError },
        resolveError: resolveIngredient.isError,
        selectSuggestion,
        selectMatch,
        findNutrition,
        pickCandidate,
        addFreeform,
        cancelDisambiguation,
    };
}
