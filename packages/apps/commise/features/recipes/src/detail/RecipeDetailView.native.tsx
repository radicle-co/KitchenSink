'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of the detail's ORCHESTRATION SHELL: it binds the SAME session serving-scale store
 * and hook the web shell binds, and hands the pure render (`RecipeDetailBody.native.tsx`) the count to
 * render at. Keeping the binding here rather than in `RecipeDetailScreen` is what makes it impossible for
 * one platform to ship the detail with the scale inert.
 */
import type { FC } from 'react';

import { RecipeDetailBody } from './RecipeDetailBody.native.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/**
 * The ORCHESTRATION shell (native): binds the session serving-scale store — the SAME store and hook the web
 * leaf uses — and hands the pure body a scaled projection. Keeping this here rather than in
 * `RecipeDetailScreen` is what makes it impossible for one platform to ship the detail with the scale
 * un-wired.
 */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);

    return <RecipeDetailBody {...props} servings={scale.servings} onServingsChange={scale.setServings} />;
};
