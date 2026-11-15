/**
 * @module CookingDoneActions — Done's two native actions, pinned in the foot where Back and Next were: Back to the
 * recipe filled, then Cook it again outlined, each full width.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import type { CookingDoneActionsProps } from './cookingViewProps.js';

/** Done's native actions. */
export const CookingDoneActions: FC<CookingDoneActionsProps> = ({ backToRecipe, cookAgain }) => (
    <YStack gap="$2" paddingHorizontal="$4" paddingBottom="$4">
        <Button size="lg" width="fill" icon="chevronLeft" onPress={backToRecipe.onPress}>
            {backToRecipe.label}
        </Button>
        <Button variant="secondary" size="lg" width="fill" icon="rotateCcw" onPress={cookAgain.onPress}>
            {cookAgain.label}
        </Button>
    </YStack>
);
