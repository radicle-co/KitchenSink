'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * The ORCHESTRATION SHELL of the recipe detail, and nothing else: it binds the session serving-scale store
 * and hands the pure render (`RecipeDetailBody.tsx`) the count to render at. The public contract
 * (`RecipeDetailViewProps`) is unchanged by that binding, which is the point — an app composes this and
 * cannot ship the detail with the serving scale un-wired, because there is nothing for it to wire.
 *
 * @pattern Orchestration shell over the Humble Object render half — it binds the session serving-scale store and
 *     hands `RecipeDetailBody` the count, so the public contract cannot be composed with the scale un-wired.
 */
import type { FC } from 'react';

import { RecipeDetailBody } from './RecipeDetailBody.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/**
 * The ORCHESTRATION shell: binds the session serving-scale store and hands the pure body a scaled
 * projection. It lives here — not in the two app containers — precisely so neither platform can ship the
 * detail screen with the scale un-wired, which is the class of defect this feature was added to close.
 */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);

    return <RecipeDetailBody {...props} servings={scale.servings} onServingsChange={scale.setServings} />;
};
