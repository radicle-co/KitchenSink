'use client';

/**
 * @module CookingDoneActions — Done's two web actions, pinned in the foot where Back and Next were: "Back to the recipe" filled, then "Cook it again" outlined, each full width.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { CookingDoneActionsProps } from './cookingViewProps.js';

/** Done's web actions. */
export const CookingDoneActions: FC<CookingDoneActionsProps> = ({ backToRecipe, cookAgain }) => (
    <div className="flex flex-col gap-2 px-4 pb-4">
        <Button size="lg" width="fill" icon="chevronLeft" onPress={backToRecipe.onPress}>
            {backToRecipe.label}
        </Button>
        <Button variant="secondary" size="lg" width="fill" icon="rotateCcw" onPress={cookAgain.onPress}>
            {cookAgain.label}
        </Button>
    </div>
);
