'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * The ORCHESTRATION SHELL of the recipe page, and nothing else: it binds what the page holds for the cook — the
 * session serving scale, the cook's marks (`useCookMarks`, blueprint A13), the one "Screen on" state with its wake
 * lock (A20), the description's and the Nutrition row's disclosures, and the pinned ingredients bar's open state — and hands the pure render (`RecipeDetailBody.tsx`) the result. The
 * public contract (`RecipeDetailViewProps`) carries none of them, which is the point: an app composes this and cannot
 * ship the page with the scale, the checks or Screen on un-wired, because there is nothing for it to wire.
 *
 * Screen on defaults to off on each visit and is released when the cook leaves the page (the hold's effect cleanup).
 *
 * @pattern Orchestration shell over the Humble Object render half — it binds the page's session state and hands
 *     `RecipeDetailBody` the result, so the public contract cannot be composed with any of it un-wired.
 */
import { useKeepAwake } from '@commise/ui/keep-awake';
import { useState, type FC } from 'react';

import { RecipeDetailBody } from './RecipeDetailBody.js';
import { useCookMarks } from './useCookMarks.js';
import { useIngredientsCardScrolledPast } from './useIngredientsCardScrolledPast.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/** The web orchestration shell of the recipe page. */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);
    const marks = useCookMarks(props.recipe.id);
    const [screenOn, setScreenOn] = useState(false);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const [nutritionExpanded, setNutritionExpanded] = useState(false);
    const { cardEndRef, scrolledPast } = useIngredientsCardScrolledPast();
    const [listOpen, setListOpen] = useState(false);
    // The bar is drawn once the card is above the chrome, and only for a recipe with lines to list (owner ruling R1).
    const barShown = scrolledPast && props.recipe.ingredients.length > 0;

    // A list left open when its bar goes away must not reopen when the bar returns: adjust the state during render.
    if (!barShown && listOpen) {
        setListOpen(false);
    }

    useKeepAwake(screenOn);

    return (
        <RecipeDetailBody
            {...props}
            servings={scale.servings}
            onServingsChange={scale.setServings}
            marks={marks}
            screenOn={{
                on: screenOn,
                onChange: setScreenOn,
            }}
            descriptionExpanded={descriptionExpanded}
            onToggleDescription={() => setDescriptionExpanded((expanded) => !expanded)}
            nutritionExpanded={nutritionExpanded}
            onToggleNutrition={() => setNutritionExpanded((expanded) => !expanded)}
            ingredientsEndRef={cardEndRef}
            pinnedIngredients={{ shown: barShown, open: listOpen && barShown, onOpenChange: setListOpen }}
        />
    );
};
