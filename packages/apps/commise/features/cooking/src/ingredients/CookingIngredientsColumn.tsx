'use client';

/**
 * @module CookingIngredientsColumn — the cooking ingredients list pinned as a column on the left (L2 and L3). It heads
 * the list with the title, which the list does not draw. It has no close and no Done, because it is always open. It
 * fills the slot the two-column layout gives it, so the one width lives in the layout.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { CookingIngredientsList } from './CookingIngredientsList.js';
import type { CookingIngredientsColumnProps } from './cookingIngredientsFrameProps.js';

/** The web ingredients column. */
export const CookingIngredientsColumn: FC<CookingIngredientsColumnProps> = (props) => (
    <div className="flex w-full flex-col gap-3">
        <h2 className="text-section-title text-ink">{props.view.title}</h2>
        <CookingIngredientsList {...props} />
    </div>
);
