'use client';

/**
 * @module @commise/features-recipes — the ingredient rows of the recipe page, grouped: a label over its run of lines, an
 * ungrouped recipe one list (`buildSpec.md` §6.1, F9). The ingredients card and the pinned list (owner ruling R1) draw the
 * SAME rows from this one component, so the two cannot disagree on a row, a group or a tick.
 */
import type { RecipeIngredientView } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { ingredientGroupRuns } from './detailFacts.js';
import { IngredientCheckRow } from './IngredientCheckRow.js';

/** What {@link IngredientRuns} draws. */
export interface IngredientRunsProps {
    /** The lines, already scaled to the chosen servings. */
    readonly ingredients: readonly RecipeIngredientView[];
    readonly checked: ReadonlySet<string>;
    /** Every line's food was removed from the catalog (the rows say so once, not on each line). */
    readonly allRemoved: boolean;
    readonly onToggle: (ingredientId: string) => void;
}

/** The grouped ingredient rows. Presentational: props → JSX, no state of its own. */
export const IngredientRuns: FC<IngredientRunsProps> = ({ ingredients, checked, allRemoved, onToggle }) => (
    <>
        {ingredientGroupRuns(ingredients).map((run, index) => (
            <div key={`${run.label ?? ''}-${String(index)}`} className="flex flex-col">
                {run.label !== undefined && <h3 className="px-4 pb-1 pt-4 text-caption text-ink-muted">{run.label}</h3>}
                <ul className="flex flex-col">
                    {run.lines.map((ingredient, lineIndex) => (
                        <IngredientCheckRow
                            key={ingredient.ingredientId}
                            divided={lineIndex > 0}
                            ingredient={ingredient}
                            checked={checked.has(ingredient.ingredientId)}
                            allRemoved={allRemoved}
                            onToggle={onToggle}
                        />
                    ))}
                </ul>
            </div>
        ))}
    </>
);
