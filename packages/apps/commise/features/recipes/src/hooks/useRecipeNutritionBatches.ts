/**
 * @module @commise/features-recipes/hooks — the RENDER-AS-YOU-FETCH seam for the deferred calorie lookup.
 *
 * **Pattern: Repository read seam (`recipeQueries().nutritionBatch`) driven as a Command at render time.**
 * The surface knows which recipes are on screen; this hook turns that into an in-flight request and a
 * per-recipe promise the card's Suspense boundary can `use()`.
 *
 * ⛔ WHY `ensureQueryData` AND NOT `useQuery`. ADR-0021 §6: mobile "calls `ensureQueryData` the moment the
 * ids are known, which returns a promise AND seeds the cache, so render finds an in-flight query". A
 * `useQuery` would hand the surface `isPending` — the prop-driven, fetch-ON-render shape — and the card
 * would have to re-derive a loading state the Suspense fallback already expresses. The promise is the
 * contract, and the skeleton is mounted from the first frame rather than from the first effect.
 *
 * ⛔ TWO DIFFERENT MECHANISMS, and confusing them is how this breaks. `use()` memoizes per PROMISE and the
 * nutrition boundary keys its error reset on promise IDENTITY, so what a card receives must be the same
 * object every render. It is NOT the memo below that guarantees that — `queryClient.ensureQueryData` answers
 * a cached query with a fresh `Promise.resolve(cachedData)` on every call, so its return value is useless as
 * an identity. The identity is `Query.promise`, the retryer's own promise, which is the same object during
 * the fetch and after it settles. The memo does the OTHER job: `ensureQueryData` re-fetches a query it finds
 * stale, so calling it once per render would fire a fresh request on every render past the 2-minute
 * `staleTime` — each of which re-renders. Both halves are pinned by their own test, and each was watched to
 * fail alone.
 *
 * ⚠️ PAGES ARE BATCHED SEPARATELY, and that is a decision rather than an accident of the signature. An
 * infinite surface (discovery) accumulates results; batching every accumulated id as ONE request would
 * change the id set — and therefore the query key AND the promise — on every "load more", so every chip
 * already on screen would fall back to its skeleton and the whole set would be re-fetched. One request per
 * page keeps each page's promise settled forever and asks food only about the recipes that are new. A
 * non-paged surface passes a single page.
 *
 * ⚠️ THE CAP IS THE CONTRACT'S, and this hook does NOT truncate to it. A page above the published 500-id
 * maximum is refused by the client before the round trip (REQ-IF-008 forbids silent truncation), the promise
 * rejects, and every card on that page renders a blank slot — the same terminal outcome as any other failed
 * lookup, never a skeleton. Every surface that uses this hook pages far below the cap.
 *
 * Platform-agnostic: no DOM and no React Native imports, so web and mobile drive the same seam.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { MAX_NUTRITION_RECIPE_IDS, type RecipeNutritionResponse } from '@kitchensink/schema-recipe';

/**
 * Resolve the batch promise covering ONE recipe.
 *
 * Returns `null` when no page on screen carries that recipe — a value the host must branch on, exactly as
 * `selectRecipeCalorieState` returns `null` for a recipe the RESPONSE omitted. The two nulls are different
 * facts ("we never asked" vs "the answer says nothing about it") that happen to render the same way: no
 * figure, and no skeleton left running.
 */
export type RecipeNutritionLookup = (recipeId: string) => Promise<RecipeNutritionResponse> | null;

/**
 * Split a flat list of recipe ids into batchable pages for {@link useRecipeNutritionBatches}. Pure.
 *
 * For a surface whose recipes did NOT arrive in pages — a collection's member list, which the server returns
 * whole. The published cap is the CALLER's problem: over {@link MAX_NUTRITION_RECIPE_IDS} the request schema
 * refuses the call before the round trip, so a 501-member collection would render every member's figure blank
 * rather than the 501st's.
 *
 * ⛔ CHUNKS, never truncates. REQ-IF-008 forbids silently dropping ids, and dropping them here would be
 * invisible: the tail's cards simply never show a figure, which is indistinguishable from those recipes
 * having none. (`@kitchensink/recipe-service-client`'s `toNutritionBatchIds` makes the OTHER choice for the
 * server-rendered path; the divergence is flagged in this phase's report rather than reconciled unilaterally.)
 *
 * @param recipeIds - Every recipe on screen, in render order.
 * @returns One page per cap-sized chunk, in order; an empty list yields no pages (and so no request).
 */
export function toRecipeNutritionPages(recipeIds: readonly string[]): readonly (readonly string[])[] {
    const pages: (readonly string[])[] = [];

    for (let start = 0; start < recipeIds.length; start += MAX_NUTRITION_RECIPE_IDS) {
        pages.push(recipeIds.slice(start, start + MAX_NUTRITION_RECIPE_IDS));
    }

    return pages;
}

/**
 * Build the identity of a set of pages — what this memo re-batches on.
 *
 * Each page is sorted, mirroring `recipeServiceKeys.recipeNutrition`, which sorts ids INTO the query key so
 * that the same recipes in a different order are ONE logical read (the discovery sort control re-orders the
 * same results). Keeping the two sorts in step means a re-sort neither rebuilds this map nor re-enters the
 * cache. It is NOT what makes the returned promise stable — that is `Query.promise`, in the loop below — so
 * dropping this sort degrades work, not correctness, which is why no test here can distinguish it. Pure.
 *
 * @param recipeIdPages - The pages of recipe ids currently on screen.
 * @returns A string that changes if and only if the batched READS change.
 */
function pagesSignature(recipeIdPages: readonly (readonly string[])[]): string {
    return recipeIdPages.map((page) => [...page].sort().join(' ')).join('|');
}

/**
 * Start the deferred nutrition lookup for the recipes on screen and hand each recipe the promise that
 * covers it.
 *
 * @param recipeIdPages - The recipe ids on screen, grouped as they were LOADED (one page per fetched page).
 *   An empty page is skipped rather than sent: the service rejects an empty id list, and `ensureQueryData`
 *   does not honour the read seam's own `enabled` gate (that is a hook-level option).
 * @returns A lookup from recipe id to the batch promise covering it, or `null` for a recipe no page carries.
 * @sideEffect Starts (or joins) one HTTP request per page and seeds the query cache — during render, by
 *   design. Repeat renders with the same pages re-use the memoized promises and start nothing.
 */
export function useRecipeNutritionBatches(recipeIdPages: readonly (readonly string[])[]): RecipeNutritionLookup {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const signature = pagesSignature(recipeIdPages);

    const byRecipeId = useMemo(() => {
        const lookup = new Map<string, Promise<RecipeNutritionResponse>>();

        for (const page of recipeIdPages) {
            if (page.length === 0) {
                continue;
            }

            const options = recipeQueries(client).nutritionBatch(page);
            const ensured = queryClient.ensureQueryData(options);
            // ⛔ THE IDENTITY COMES FROM THE QUERY, NOT FROM THIS MEMO. `ensureQueryData` answers a cached
            // query with a fresh `Promise.resolve(data)` every call, and this memo recomputes whenever ANY
            // page changes — so sourcing identity from it would hand page one a new promise the moment page
            // two loaded, and every settled chip on screen would blink back to its skeleton. `Query.promise`
            // is the retryer's own promise: the SAME object during the fetch and after it settles (verified
            // against `@tanstack/query-core`), owned by the layer that owns the data rather than copied into
            // ours. The `??` covers a query whose data arrived without a fetch (`setQueryData`, hydration),
            // which has no retryer and therefore no promise.
            const promise =
                queryClient.getQueryCache().find<RecipeNutritionResponse>({ queryKey: options.queryKey })?.promise ??
                ensured;

            // The card's error boundary is what turns a failed lookup into a blank slot, but it can only do
            // that once it has rendered. Until then nothing of ours is attached to this promise, and a
            // rejection with no handler is an unhandled rejection — which crashes a React Native app rather
            // than blanking a chip. `.catch` returns a NEW promise; the identity handed to the boundary is
            // the original, which is what is stored below.
            promise.catch(() => undefined);
            ensured.catch(() => undefined);

            for (const recipeId of page) {
                // First page wins: a recipe that appeared on page one keeps page one's settled promise even
                // if a later page repeats it, so its chip never falls back to a skeleton.
                if (!lookup.has(recipeId)) {
                    lookup.set(recipeId, promise);
                }
            }
        }

        return lookup;
        // Keyed on the SIGNATURE, not on `recipeIdPages` itself: a container that rebuilds its id array every
        // render (the common case — `pages.map(...)`) would otherwise re-batch on every render. The array is
        // read through that signature by construction, so the two cannot disagree.
    }, [signature, client, queryClient]);

    return useMemo(() => (recipeId: string) => byRecipeId.get(recipeId) ?? null, [byRecipeId]);
}
