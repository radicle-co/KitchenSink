/**
 * @module @commise/features-recipes/card — the recipe card's props, the two contexts its Root gives its parts, and the one
 * reader of the card's view, shared by the web and native `RecipeCard` leaves (W9-f P7).
 *
 * The view's context and its reader are kept together because the reader is the only correct way to touch it: it turns
 * a part rendered outside a card into a stated error instead of a silent `null`.
 *
 * @pattern Provider — the Root carries the card's view and its nutrition slot to the parts, so each surface composes its
 *     own arrangement without threading props through it
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { RecipeCardModel } from './model.js';
import type { RecipeCardView } from './recipeCardView.js';

/** Props for the shared recipe card (both leaves). */
export interface RecipeCardProps {
    readonly recipe: RecipeCardModel;
    /** When provided, the card is an actionable control that reports the recipe id (the list card). */
    readonly onSelect?: (id: string) => void;
    /**
     * The recipe's per-serving nutrition, as an already-decided NODE rendered in the meta row.
     *
     * A SLOT rather than a field, because the figure is a DEFERRED lookup that lands after the card does:
     * the list holds the promise and decides what belongs here (`RecipeNutritionBoundary`, a settled
     * `RecipeCalorieChip`, or nothing at all), and the card stays pure and knows nothing about loading. An
     * ABSENT slot renders no line at all — the same absent-value rule as difficulty, cuisine and tags, and
     * never a placeholder or a fabricated 0.
     *
     * ⚠️ It is `RecipeCard.Meta` that renders this. A custom arrangement (`children`) that omits `.Meta`
     * DROPS the slot silently — unlike a misplaced part, which throws — because an unrendered optional node
     * is indistinguishable from an absent one. `RecipeDiscoveryCard` and `CollectionMemberRow` are exactly
     * such arrangements, so check for `<RecipeCard.Meta />` before concluding the figure never arrived.
     */
    readonly nutrition?: ReactNode;
    /** Custom arrangement of `RecipeCard.*` parts. Omit for the default merged card (list/widget). */
    readonly children?: ReactNode;
}

/** The card's view, carried to the parts so no surface has to thread props through the arrangement. */
export const RecipeCardViewContext = createContext<RecipeCardView | null>(null);

/**
 * The nutrition slot's content, carried to `RecipeCard.Meta` the same way the view reaches the other parts. Kept as its
 * OWN context rather than folded into the view: the view is data derived from a recipe, and this is a rendered node the
 * composing surface supplies, so merging them would put a `ReactNode` inside a pure, serializable view.
 */
export const RecipeCardNutritionContext = createContext<ReactNode>(null);

/**
 * Read the card's view from the nearest `RecipeCard`.
 *
 * @returns The view.
 * @throws {Error} when a part is rendered outside a `RecipeCard`.
 */
export function useCardView(): RecipeCardView {
    const view = useContext(RecipeCardViewContext);

    if (view === null) {
        throw new Error('RecipeCard.* parts must be rendered inside a <RecipeCard>.');
    }

    return view;
}
