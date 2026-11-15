'use client';

/**
 * @module @commise/features-recipes — the native ingredient rows, grouped: a label over its run of lines, an ungrouped
 * recipe one list (`buildSpec.md` §6.1, F9). The ingredients card and the pinned list (owner ruling R1) draw the SAME rows
 * from this one component, so the two cannot disagree on a row, a group or a tick. The native twin of `IngredientRuns.tsx`.
 */
import { Fragment, type FC } from 'react';

import { ingredientGroupRuns, withReviewAction } from './detailFacts.js';
import { IngredientGroupLabel } from './ingredientFrames.native.js';
import { IngredientCheckRow } from './IngredientCheckRow.native.js';
import type { IngredientRunsProps } from './IngredientRuns.js';

/** The grouped ingredient rows. Presentational: props → JSX, no state of its own. */
export const IngredientRuns: FC<IngredientRunsProps> = ({
    ingredients,
    checked,
    allRemoved,
    onToggle,
    reviewAction,
}) => (
    <>
        {ingredientGroupRuns(
            ingredients.map((ingredient, position) => ({ ingredient, position, groupLabel: ingredient.groupLabel })),
        ).map((run, index) => (
            <Fragment key={`${run.label ?? ''}-${String(index)}`}>
                {run.label !== undefined && <IngredientGroupLabel>{run.label}</IngredientGroupLabel>}
                {run.lines.map(({ ingredient, position }, lineIndex) => (
                    <IngredientCheckRow
                        // The stored position, never `ingredientId`: two lines can share a food.
                        key={position}
                        ingredient={ingredient}
                        checked={checked.has(ingredient.ingredientId)}
                        allRemoved={allRemoved}
                        onToggle={onToggle}
                        divided={lineIndex > 0}
                        {...withReviewAction(reviewAction?.(position, ingredient))}
                    />
                ))}
            </Fragment>
        ))}
    </>
);
