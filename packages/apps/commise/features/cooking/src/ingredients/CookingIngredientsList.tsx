'use client';

/**
 * @module CookingIngredientsList — the cooking ingredients list on web: the title, the servings stepper, one row per
 * line and Clear ticks. Every piece is the recipe page's own (`IngredientCheckRow`, `ServingScaleControl`, through
 * `@commise/features-recipes/cook`), so cooking mode names a line, sets an amount and counts servings exactly as the
 * page does, in the page's own words.
 *
 * It holds no state and no frame: the sheet and the column wrap it, and the screen binds `useCookingIngredients`.
 * Clear ticks is drawn only while a line is ticked, because with none ticked it has nothing to do.
 *
 * Presentational: props → JSX.
 */
import { IngredientCheckRow, ServingScaleControl } from '@commise/features-recipes/cook';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { CookingIngredientsListProps } from './cookingIngredientsListProps.js';

/** The web cooking ingredients list. */
export const CookingIngredientsList: FC<CookingIngredientsListProps> = ({
    view,
    copy,
    onToggle,
    onSetServings,
    onClear,
}) => (
    <div className="flex flex-col gap-3">
        <h2 className="text-section-title text-ink">{view.title}</h2>
        <ServingScaleControl
            servings={view.servings}
            baseServings={view.baseServings}
            onServingsChange={onSetServings}
        />
        <div>
            {view.rows.map((row, position) => (
                <IngredientCheckRow
                    // The stored position, never `ingredientId`: two lines can share a food (see `IngredientRuns`).
                    key={position}
                    ingredient={row.ingredient}
                    checked={row.checked}
                    allRemoved={view.allRemoved}
                    onToggle={onToggle}
                    divided={position > 0}
                />
            ))}
        </div>
        {view.rows.some((row) => row.checked) && (
            <Button variant="quiet" size="md" onPress={onClear}>
                {copy.clear}
            </Button>
        )}
    </div>
);
