/**
 * @module @commise/features-recipes/form — the editor's ONE background nutrition read (plan 002 U9,
 * `POST /api/v1/ingredients/food-nutrition`), turned into a per-line lookup that the row panel and the running total
 * both read (blueprint Decision 3). Nutrition never enters the draft; it lives here.
 *
 * Pure: `useLineNutrition` (`../hooks/useLineNutrition.ts`) owns the query and hands its state in.
 *
 * @pattern Adapter — the batch read's answer adapted to a per-line lookup
 */
import { FoodResolutionStatus, type LineCatalogNutrition } from '@kitchensink/recipe-core';
import type { IngredientFoodNutritionRequest, IngredientFoodNutritionResponse } from '@kitchensink/schema-recipe';

import type { RecipeFormIngredient, RecipeFormValues } from './values.js';

/** A food as the nutrition read names it, derived from the published request (ADR-0014). */
export type FoodNutritionRef = IngredientFoodNutritionRequest['refs'][number];

/** What the read knows about one ref. */
export type LookupEntry =
    /** The read has not answered for it yet. */
    | { readonly state: 'pending' }
    /** The read itself failed (offline, a server error). */
    | { readonly state: 'failed' }
    /** Food could not be asked about it, and nothing was cached. */
    | { readonly state: 'unavailable' }
    /** Food answered with nothing the caller may read. An answer, not a failure. */
    | { readonly state: 'absent' }
    /** Food answered with its figures; a figure it does not publish stays absent, never 0. */
    | { readonly state: 'found'; readonly catalog: LineCatalogNutrition };

/** The per-line lookup the panel and the total read. */
export type LineNutritionLookup = (ref: FoodNutritionRef) => LookupEntry;

/** The read's state, as the query reports it. */
export type NutritionRead =
    | { readonly status: 'pending' }
    | { readonly status: 'error' }
    /**
     * An answer. `complete` is false when it is the PREVIOUS read's answer kept on screen while a new one runs
     * (placeholder data), so a ref it does not mention is still loading rather than missing.
     */
    | { readonly status: 'success'; readonly response: IngredientFoodNutritionResponse; readonly complete: boolean };

/** One ref's identity: its kind AND its id, because a root and a variant may share an id. Pure. */
const refKeyOf = (ref: FoodNutritionRef): string => `${ref.kind}:${ref.id}`;

/** The line statuses that withhold a line's catalog figures — the two the detail read reports for a withheld line. */
const CATALOG_WITHHELD: ReadonlySet<FoodResolutionStatus> = new Set([
    FoodResolutionStatus.NEEDS_REVIEW,
    FoodResolutionStatus.PENDING_VERIFICATION,
]);

/**
 * Whether the editor withholds this line's CATALOG figures, as the detail read does: recipe-service's
 * `isWithheldLine` (`recipes/domain/lineVerification.ts`) withholds a line the verification gate contradicted or has
 * not judged yet, and those lines reach the wire as `NEEDS_REVIEW` or `PENDING_VERIFICATION` — still carrying their
 * `foodId`. Figures the cook stated are not withheld. Pure.
 *
 * ⚠️ A gate-contradicted IDENTITY reads `AMBIGUOUS`, which the server also withholds; an abstention over a varied
 * shortlist reads `AMBIGUOUS` too and is NOT withheld. The wire does not tell them apart, so `AMBIGUOUS` is counted.
 *
 * @param line - The draft line.
 * @returns `true` when the line's catalog figures must not count.
 */
export const isCatalogWithheld = (line: Pick<RecipeFormIngredient, 'resolutionStatus'>): boolean =>
    line.resolutionStatus !== undefined && CATALOG_WITHHELD.has(line.resolutionStatus);

/**
 * The distinct food refs the draft's lines are bound to, in first-appearance order — skipping a line whose catalog
 * figures are withheld ({@link isCatalogWithheld}), so no read is made for a food nothing would count. Pure.
 *
 * @param values - The editor's draft.
 * @returns The refs to read; empty when no line is food-backed (then no read is made).
 */
export const refsOf = (values: RecipeFormValues): FoodNutritionRef[] => {
    const byKey = new Map<string, FoodNutritionRef>();

    for (const line of values.ingredients) {
        if (line.foodRef !== undefined && !isCatalogWithheld(line) && !byKey.has(refKeyOf(line.foodRef))) {
            byKey.set(refKeyOf(line.foodRef), line.foodRef);
        }
    }

    return [...byKey.values()];
};

/** One answered entry as a lookup entry. Pure. */
const entryOf = (entry: IngredientFoodNutritionResponse['entries'][number]): LookupEntry => {
    switch (entry.outcome) {
        case 'found':
            return {
                state: 'found',
                catalog: {
                    ...(entry.caloriesPer100g === undefined ? {} : { caloriesPer100g: entry.caloriesPer100g }),
                    ...(entry.proteinGPer100g === undefined ? {} : { proteinGPer100g: entry.proteinGPer100g }),
                    ...(entry.carbsGPer100g === undefined ? {} : { carbsGPer100g: entry.carbsGPer100g }),
                    ...(entry.fatGPer100g === undefined ? {} : { fatGPer100g: entry.fatGPer100g }),
                    ...(entry.portions.length === 0 ? {} : { portions: entry.portions }),
                },
            };
        case 'absent':
            return { state: 'absent' };
        case 'unavailable':
            return { state: 'unavailable' };
    }
};

/**
 * The per-line lookup over one read's state. Pure.
 *
 * @param read - The read's state.
 * @returns The lookup.
 */
export const nutritionLookupFrom = (read: NutritionRead): LineNutritionLookup => {
    if (read.status === 'pending') {
        return () => ({ state: 'pending' });
    }

    if (read.status === 'error') {
        return () => ({ state: 'failed' });
    }

    const byKey = new Map(read.response.entries.map((entry) => [refKeyOf(entry.ref), entryOf(entry)] as const));

    return (ref) => byKey.get(refKeyOf(ref)) ?? (read.complete ? { state: 'unavailable' } : { state: 'pending' });
};

/** The parts of the query the read is derived from. */
export interface NutritionQueryState {
    readonly data: IngredientFoodNutritionResponse | undefined;
    readonly isPlaceholderData: boolean;
    readonly isError: boolean;
}

/**
 * The read's state from the query's. Pure.
 *
 * @param refCount - How many refs the draft asked about. With none, no read is made and none is owed.
 * @param query - The query's data, placeholder flag and error flag.
 * @returns The read's state.
 */
export const nutritionReadFrom = (refCount: number, query: NutritionQueryState): NutritionRead => {
    if (refCount === 0) {
        return { status: 'success', response: { entries: [] }, complete: true };
    }

    // An answer already on screen survives a failed refetch of the SAME refs. When the refs changed and the new read
    // fails, TanStack drops the placeholder, so every ref reads as failed (REVIEW F5: a known gap, not handled).
    if (query.data !== undefined) {
        return { status: 'success', response: query.data, complete: !query.isPlaceholderData };
    }

    return query.isError ? { status: 'error' } : { status: 'pending' };
};

/** What the editor knows about nutrition: the per-line lookup, the read's overall state, and its retry. */
export interface IngredientNutrition {
    readonly lookup: LineNutritionLookup;
    /** `loading` until the first answer; `failed` when the read failed with nothing to show; `ready` otherwise. */
    readonly read: 'loading' | 'ready' | 'failed';
    /** Read again (the panel's and the total's Try again). */
    readonly retry: () => void;
}

/**
 * The editor's nutrition from one read's state. Pure.
 *
 * @param read - The read's state.
 * @param retry - Read again.
 * @returns The editor's nutrition.
 */
export const ingredientNutritionFrom = (read: NutritionRead, retry: () => void): IngredientNutrition => ({
    lookup: nutritionLookupFrom(read),
    read: read.status === 'pending' ? 'loading' : read.status === 'error' ? 'failed' : 'ready',
    retry,
});
