/**
 * @module CookingIngredientsColumn — the cooking ingredients list pinned as the column on the left (L2 and L3).
 * It heads the list with the title, which the list does not draw. It has no close and no Done, because it is always
 * open. It sets no width: the two-column layout's slot owns it (`INGREDIENTS_COLUMN`), so the column fills the slot.
 *
 * Presentational: props → JSX.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { CookingIngredientsList } from './CookingIngredientsList.native.js';
import type { CookingIngredientsColumnProps } from './cookingIngredientsFrameProps.js';

/** The native ingredients column. */
export const CookingIngredientsColumn: FC<CookingIngredientsColumnProps> = (props) => (
    <YStack testID="cooking-ingredients-column" gap="$3">
        <Text role="heading" aria-level={2} typeRole="sectionTitle" color="$ink">
            {props.view.title}
        </Text>
        <CookingIngredientsList {...props} />
    </YStack>
);
