/**
 * @module cookingIngredientsListProps — the one props contract of the cooking ingredients list, on web and native. The
 * list is pure props to markup: the screen binds `useCookingIngredients` and hands the list its view and commands.
 *
 * It holds no Done, no frame and no mode prop. The sheet frame, the column frame and the binding screen own those, so
 * the list is the same on every layout band.
 */
import type { CookingMessages } from '../messages.js';

import type { CookingIngredientsView } from './ingredientsView.js';

/** The list variant of the view, the only one a list renders. The screen never mounts the list for `none`. */
export type CookingIngredientsListView = Extract<CookingIngredientsView, { readonly kind: 'list' }>;

/** What `CookingIngredientsList` (web and native) is given. */
export interface CookingIngredientsListProps {
    /** From `useCookingIngredients().view`, narrowed to the list by the caller. */
    readonly view: CookingIngredientsListView;
    /** The Clear ticks label. The title arrives ready-made in `view.title`. */
    readonly copy: Pick<CookingMessages['ingredients'], 'clear'>;
    /** Tick or untick one line, by its ingredient id. */
    readonly onToggle: (ingredientId: string) => void;
    /** Choose the servings. The store keeps the count inside the recipe's supported range. */
    readonly onSetServings: (servings: number) => void;
    /** Clear every tick. The caller owns the Undo that the command returns, so the list never sees it. */
    readonly onClear: () => void;
}
