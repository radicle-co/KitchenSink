/**
 * @module CookingIngredientsList — the cooking ingredients list on native: the servings stepper, the lines under their
 * section labels and Clear ticks. Every piece is the recipe page's own (`IngredientRuns`, `ServingScaleControl`,
 * through `@commise/features-recipes/cook`), so cooking mode groups, names and keys a line, sets an amount and counts
 * servings exactly as the page does, in the page's own words.
 *
 * It holds no state, no frame and no heading: the sheet and the column wrap it and draw the title, and the screen binds
 * `useCookingIngredients`. Clear ticks is drawn only while a line of the list is ticked (`view.hasTicks`), because with
 * none ticked it has nothing to do.
 *
 * Presentational: props → JSX.
 */
import { IngredientRuns, ServingScaleControl } from '@commise/features-recipes/cook';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import type { CookingIngredientsListProps } from './cookingIngredientsListProps.js';

/** The native cooking ingredients list. */
export const CookingIngredientsList: FC<CookingIngredientsListProps> = ({
    view,
    copy,
    onToggle,
    onSetServings,
    onClear,
}) => (
    <YStack gap="$3">
        <ServingScaleControl
            servings={view.servings}
            baseServings={view.baseServings}
            onServingsChange={onSetServings}
        />
        <YStack>
            <IngredientRuns
                ingredients={view.ingredients}
                checked={view.checked}
                allRemoved={view.allRemoved}
                onToggle={onToggle}
            />
        </YStack>
        {view.hasTicks && onClear !== undefined && (
            <Button variant="quiet" size="md" onPress={onClear}>
                {copy.clear}
            </Button>
        )}
    </YStack>
);
