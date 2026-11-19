/**
 * @module CookingIngredientsList — the cooking ingredients list on native: the title, the servings stepper, one row per
 * line and Clear ticks. Every piece is the recipe page's own (`IngredientCheckRow`, `ServingScaleControl`, through
 * `@commise/features-recipes/cook`), so cooking mode names a line, sets an amount and counts servings exactly as the page
 * does, in the page's own words.
 *
 * It holds no state and no frame: the sheet and the column wrap it, and the screen binds `useCookingIngredients`.
 * Clear ticks is drawn only while a line is ticked, because with none ticked it has nothing to do.
 *
 * Presentational: props → JSX.
 */
import { IngredientCheckRow, ServingScaleControl } from '@commise/features-recipes/cook';
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
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
        <Text role="heading" aria-level={2} typeRole="sectionTitle" color="$ink">
            {view.title}
        </Text>
        <ServingScaleControl
            servings={view.servings}
            baseServings={view.baseServings}
            onServingsChange={onSetServings}
        />
        <YStack>
            {view.rows.map((row, index) => (
                <IngredientCheckRow
                    key={row.ingredient.ingredientId}
                    ingredient={row.ingredient}
                    checked={row.checked}
                    allRemoved={view.allRemoved}
                    onToggle={onToggle}
                    divided={index > 0}
                />
            ))}
        </YStack>
        {view.rows.some((row) => row.checked) && (
            <Button variant="quiet" size="md" onPress={onClear}>
                {copy.clear}
            </Button>
        )}
    </YStack>
);
