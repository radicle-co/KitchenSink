/**
 * @module @commise/features-recipes/hooks — the deferred calorie lookup's one read seam, for both platforms.
 *
 * **Pattern: Repository read seam (`recipeQueries().nutritionBatch`) observed through `useQueries`, folded by `combine`
 * into a lookup.** The surface knows which recipes are on screen, grouped as they were loaded; this hook subscribes to
 * ONE batch query per page and hands the surface a lookup from recipe id to that page's READING — `pending`, `failed`
 * or `settled` (`RecipeNutritionBatchReading`).
 *
 * ⛔ A READING, NEVER A PROMISE (ADR-0079). This hook used to hand each card a promise for a Suspense boundary to
 * `use()`. A committed calorie skeleton's retry lane then ran ahead of every pinged deferred update on its screen —
 * "See all", a library sort, a collection switch — so each of them waited on the calorie lookup, up to its 12 s
 * deadline. A reading cannot suspend, so the lookup cannot hold anything up. `repoGuards`' `nutritionNeverSuspends`
 * refuses `use(`, `Suspense` and `useSuspense*` in this file.
 *
 * ⚠️ THE MAPPING IS THE CONTRACT ({@link toBatchReading}). Data present is `settled` — through a background refetch
 * (no skeleton flashes back over a figure) and through a later FAILED refetch (a figure is not withdrawn for a blip).
 * An error with no data is `failed`, a terminal answer. Anything else is `pending`, which the read seam's deadline
 * (`NUTRITION_BATCH_DEADLINE_MS`, in the client) always ends.
 *
 * ⚠️ PAGES ARE BATCHED SEPARATELY, and that is a decision rather than an accident of the signature. An infinite
 * surface (discovery) accumulates results; batching every accumulated id as ONE request would change the id set — and
 * therefore the query key — on every "load more", so every chip already on screen would fall back to its skeleton and
 * the whole set would be re-fetched. One query per page keeps each page's answer and asks food only about the recipes
 * that are new. A non-paged surface passes a single page.
 *
 * ⚠️ THE CAP IS THE CONTRACT'S, and this hook does NOT truncate to it. A page above the published 500-id maximum is
 * refused by the client before the round trip (REQ-IF-008 forbids silent truncation), the query fails, and every card
 * on that page reads `failed` — never a skeleton. Every surface that uses this hook pages far below the cap.
 *
 * Platform-agnostic: no DOM and no React Native imports, so web and mobile drive the same seam.
 */
import { useQueries, type QueryObserverResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { MAX_NUTRITION_RECIPE_IDS, type RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import type { RecipeNutritionBatchReading } from '../nutrition/model.js';

/**
 * Resolve the batch reading covering ONE recipe.
 *
 * Returns `null` when no page on screen carries that recipe — a value the host must branch on, exactly as
 * `selectRecipeCalorieState` returns `null` for a recipe the RESPONSE omitted. The two nulls are different facts ("we
 * never asked" vs "the answer says nothing about it") that render the same way: no figure, and no skeleton left
 * running.
 */
export type RecipeNutritionLookup = (recipeId: string) => RecipeNutritionBatchReading | null;

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
 * Build the identity of a set of pages — what the hook rebuilds its queries and its `combine` on.
 *
 * Each page is sorted, mirroring `recipeServiceKeys.recipeNutrition`, which sorts ids INTO the query key so that the
 * same recipes in a different order are ONE logical read (a sort control re-orders the same results). Keeping the two
 * sorts in step means a re-sort keeps the same queries AND the same lookup, so no card re-renders for it. Pure.
 *
 * @param recipeIdPages - The pages of recipe ids currently on screen.
 * @returns A string that changes if and only if the batched READS change.
 */
function pagesSignature(recipeIdPages: readonly (readonly string[])[]): string {
    return recipeIdPages.map((page) => [...page].sort().join(' ')).join('|');
}

/**
 * The pages a {@link pagesSignature} was built from — each page's ids SORTED, which is how the nutrition query keys
 * them anyway, so reading pages back from the signature asks for exactly the queries the caller's pages would.
 *
 * The hook reads its pages from HERE rather than closing over the caller's array: the array is rebuilt on most
 * renders, so the hook's memo is keyed on the signature, and a memo that read anything else would be depending on a
 * value its key does not cover.
 *
 * @param signature - A signature from {@link pagesSignature}. Ids never contain a space or `|`.
 * @returns The pages the signature encodes, an empty page as `[]`. ⚠️ NOT a total inverse: no pages and one empty
 *   page both encode to `''`, which reads back as one empty page. Both mean "ask about nothing", and the hook skips
 *   every empty page, so the two readings cannot differ in what is asked.
 */
function pagesFromSignature(signature: string): readonly (readonly string[])[] {
    return signature.split('|').map((page) => (page === '' ? [] : page.split(' ')));
}

/**
 * Read one page's query as a batch reading. Pure, and TOTAL over every query state.
 *
 * Data first, on purpose: a query keeps its last data through a background refetch and through a failed one, and a
 * card that has a figure keeps showing it. Only with NO data does an error become `failed`.
 *
 * @param result - The page's query observer result (only its data and status are read).
 * @returns The reading a card renders.
 */
function toBatchReading(
    result: Pick<QueryObserverResult<RecipeNutritionResponse>, 'data' | 'status'>,
): RecipeNutritionBatchReading {
    if (result.data !== undefined) {
        return { status: 'settled', response: result.data };
    }

    return result.status === 'error' ? { status: 'failed' } : { status: 'pending' };
}

/**
 * Subscribe to the deferred nutrition lookup for the recipes on screen and hand each recipe its page's reading.
 *
 * @param recipeIdPages - The recipe ids on screen, grouped as they were LOADED (one page per fetched page). An empty
 *   page is skipped rather than sent: the service rejects an empty id list.
 * @returns A lookup from recipe id to the reading of the page that carries it, or `null` for a recipe no page carries.
 *   The SAME function for as long as the pages and their readings are the same, so a host may memoize on it.
 * @sideEffect Starts (or joins) one HTTP request per page when the host commits, through the query cache.
 */
export function useRecipeNutritionBatches(recipeIdPages: readonly (readonly string[])[]): RecipeNutritionLookup {
    const client = useRecipeServiceClient();
    const signature = pagesSignature(recipeIdPages);

    // Keyed on the SIGNATURE, not on `recipeIdPages` itself: a container that rebuilds its id array every render (the
    // common case — `pages.map(...)`) would otherwise rebuild the query list and the `combine` below on every render.
    // The pages are READ from that signature (`pagesFromSignature`), so the key covers everything this depends on.
    // ⛔ EVERY empty page is skipped: the service REJECTS an empty id list (`.min(1)`), so sending one is a
    // guaranteed failure, and it covers both `[]` and `[[]]`, which share the signature `''`.
    const pages = useMemo(() => pagesFromSignature(signature).filter((page) => page.length > 0), [signature]);

    // ⛔ STABLE BY CONSTRUCTION. `useQueries` re-runs `combine` only when the function or a query result changes, so a
    // `combine` rebuilt every render would hand every host a new lookup — and a new render prop, and a re-render of
    // every card — on every render.
    const combine = useCallback(
        (results: readonly Pick<QueryObserverResult<RecipeNutritionResponse>, 'data' | 'status'>[]) => {
            const byRecipeId = new Map<string, RecipeNutritionBatchReading>();

            pages.forEach((page, index) => {
                const result = results[index];

                // Index-bound (`noUncheckedIndexedAccess` is off): `results` follows `queries`, which is `pages`.
                if (result === undefined) {
                    return;
                }

                const reading = toBatchReading(result);

                for (const recipeId of page) {
                    // First page wins: a recipe that appeared on page one keeps page one's reading even if a later
                    // page repeats it, so its chip never falls back to a skeleton.
                    if (!byRecipeId.has(recipeId)) {
                        byRecipeId.set(recipeId, reading);
                    }
                }
            });

            return (recipeId: string): RecipeNutritionBatchReading | null => byRecipeId.get(recipeId) ?? null;
        },
        [pages],
    );

    return useQueries({
        queries: useMemo(
            () =>
                pages.map((page) => ({
                    ...recipeQueries(client).nutritionBatch(page),
                    // Stated, not inherited: a failed lookup is a READING a card renders, never a throw to the screen's
                    // error boundary, whatever an app's query defaults become.
                    throwOnError: false,
                })),
            [pages, client],
        ),
        combine,
    });
}
