/**
 * @module @commise/features-recipes/__fixtures__ — a food list's view, as tests build it from the ONE progressive answer
 * (`hooks/foodSuggestions.model.ts`): one food of each database group, and a served view built from frames by the real
 * model, so a test never hand-writes a view the model could not produce.
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';

import {
    entrySearchViewOf,
    type AuthoredFoodHit,
    type AuthoredFoodOption,
    type CatalogFoodHit,
    type CatalogFoodOption,
    type EntrySearchView,
    type FoodGroup,
    type FoodOption,
} from '../hooks/foodSuggestions.model.js';
import { answerOf } from './progressiveFrames.js';

/** One of the cook's own foods, as the database frame carries it. */
export const makeAuthoredFoodOption = (
    over: Partial<AuthoredFoodHit> & { readonly name?: string } = {},
): AuthoredFoodOption => ({
    group: 'authored',
    hit: { id: 'food_own', score: 0.5, ...over, name: over.name ?? 'My food' },
});

/** A catalog food, as the database frame carries it; give it a `variant` for a result the search matched to one. */
export const makeCatalogFoodOption = (
    over: Partial<CatalogFoodHit> & { readonly name?: string } = {},
): CatalogFoodOption => ({
    group: 'catalog',
    hit: { id: 'food_catalog', score: 0.9, ...over, name: over.name ?? 'Catalog food' },
});

/**
 * The view of an answer that arrived as `frames`, for the text `text`: still running, or ended.
 *
 * @param frames - The frames, in arrival order.
 * @param options - The text (`egg` unless given), and whether the answer still runs.
 * @returns The view the real model derives.
 */
export const progressiveFoodView = (
    frames: readonly ProgressiveFrame[],
    options: { readonly text?: string; readonly running?: boolean } = {},
): EntrySearchView => {
    const text = options.text ?? 'egg';

    return entrySearchViewOf({
        trimmed: text,
        debouncedTrimmed: text,
        read: { kind: options.running === true ? 'asking' : 'ended', answer: answerOf(...frames), resumed: false },
    });
};

/** A database group a test reads as failed. */
export const UNAVAILABLE_GROUP = 'unavailable';

/** A database group that answered with `foods`. */
export const answeredGroup = <O extends FoodOption>(...foods: O[]): readonly O[] => foods;

/** One database group as {@link settledFoodView} takes it: its foods, or failed. */
type GroupArg<O extends FoodOption> = readonly O[] | typeof UNAVAILABLE_GROUP;

/** The model's group for a test's group. Pure. */
const groupOf = <O extends FoodOption>(group: GroupArg<O>): FoodGroup<O> =>
    group === UNAVAILABLE_GROUP ? { kind: 'unavailable' } : { kind: 'answered', foods: group };

/**
 * A complete answer whose remote sources added nothing: the cook's own foods, then the catalog's, as the model serves
 * them (`entrySearchViewOf`'s `served` view). For a test about the database part alone.
 *
 * @param authored - The cook's own foods, or failed.
 * @param catalog - The catalog's foods, or failed.
 * @returns The view.
 */
export const settledFoodView = (
    authored: GroupArg<AuthoredFoodOption>,
    catalog: GroupArg<CatalogFoodOption>,
): EntrySearchView => ({
    kind: 'served',
    database: { authored: groupOf(authored), catalog: groupOf(catalog) },
    remote: [],
    progress: 'complete',
    resumed: false,
});
