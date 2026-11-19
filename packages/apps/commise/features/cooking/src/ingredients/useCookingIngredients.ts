/**
 * @module useCookingIngredients — cooking mode's binding to its ingredients list: the rows scaled to the cook's
 * servings, the ticks and the servings shared with the recipe page, and Clear ticks as a command that hands back its
 * own Undo.
 *
 * The recipe's lines and its authored servings are SNAPSHOT at mount, so a refetch that reorders or adds lines under
 * the cook never moves a row they are reading. The cook's ticks are keyed by a line's content (ADR-0096), so the snapshot and the page's fresh lines agree on which
 * line is ticked.
 * The snapshot assumes ONE recipe for each mount: a screen that opens another recipe must mount the hook again.
 *
 * @pattern Headless hook: no markup, only the data and the commands a list renders.
 * @pattern Command: `clearTicks` returns its inverse, which the session guard wraps.
 */
import { useCookMarks, useServingScale } from '@commise/features-recipes/cook';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';
import { useCallback, useMemo, useState } from 'react';

import type { CookingMessages } from '../messages.js';

import { cookingIngredientsView, type CookingIngredientsView } from './ingredientsView.js';

/** What the hook is bound to. */
export interface UseCookingIngredientsInput {
    /** The recipe the cook holds: its id, its lines and the servings it was authored with. */
    readonly recipe: {
        readonly id: string;
        readonly ingredients: readonly RecipeIngredientView[];
        readonly servings: number;
    };
    /** The copy the list says. */
    readonly copy: Pick<CookingMessages, 'ingredients' | 'step'>;
    /** The locale, for the plural. */
    readonly locale: string;
}

/** What the screen renders and calls. */
export interface CookingIngredientsBinding {
    readonly view: CookingIngredientsView;
    /** Tick or untick one line, by its position in `view.ingredients`. */
    readonly toggle: (position: number) => void;
    /** Choose the servings. The store keeps the count inside the recipe's supported range. */
    readonly setServings: (servings: number) => void;
    /**
     * Clear every tick and keep the current step.
     *
     * @returns The Undo: it adds back the ticks this call cleared and removes none.
     * @sideEffect Writes the cook's marks, which the recipe page reads too.
     */
    readonly clearTicks: () => () => void;
}

/**
 * Bind cooking mode's ingredients list.
 *
 * @param input - The recipe, the copy and the locale.
 * @returns The list view and its commands.
 * @sideEffect Subscribes to the cook marks and the serving scale.
 */
export function useCookingIngredients(input: UseCookingIngredientsInput): CookingIngredientsBinding {
    const { recipe, copy, locale } = input;
    const [snapshot] = useState(() => ({ ingredients: recipe.ingredients, baseServings: recipe.servings }));
    const marks = useCookMarks(recipe.id, snapshot.ingredients);
    const scale = useServingScale(recipe.id, snapshot.baseServings);
    const { checkedLines, toggleLine, clearIngredientTicks, restoreIngredientTicks } = marks;

    const view = useMemo(
        () =>
            cookingIngredientsView({
                ingredients: snapshot.ingredients,
                baseServings: snapshot.baseServings,
                servings: scale.servings,
                ticked: checkedLines,
                copy,
                locale,
            }),
        [snapshot, scale.servings, checkedLines, copy, locale],
    );

    const clearTicks = useCallback((): (() => void) => {
        const cleared = [...checkedLines];

        clearIngredientTicks();

        return () => {
            restoreIngredientTicks(cleared);
        };
    }, [checkedLines, clearIngredientTicks, restoreIngredientTicks]);

    return { view, toggle: toggleLine, setServings: scale.setServings, clearTicks };
}
