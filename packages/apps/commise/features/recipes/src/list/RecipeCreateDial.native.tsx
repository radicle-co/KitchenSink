/**
 * @module @commise/features-recipes — native recipe-list CREATE DIAL (presentational).
 *
 * The React Native leaf of `RecipeCreateDial`: the pinned FAB that discloses the creation destinations (U34), mounted
 * by the settled results and by the load error so the destination list is spelled once.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { SpeedDial } from '../speedDial/SpeedDial.native.js';
import type { RecipeCreateDestinations } from './model.js';

export const RecipeCreateDial: FC<RecipeCreateDestinations> = ({ onCreateRecipe, onPasteIngredients }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <SpeedDial
            triggerLabel={list.createCta}
            menuLabel={list.createMenuLabel}
            dismissLabel={list.createMenuDismiss}
            // ⚠️ A spread, not a ternary over two arrays: `actions` is a NON-EMPTY tuple, so scratch stays first by
            // construction.
            actions={[
                { id: 'scratch', label: list.createFromScratch, onSelect: onCreateRecipe },
                ...(onPasteIngredients === undefined
                    ? []
                    : [{ id: 'paste', label: list.createFromPaste, onSelect: onPasteIngredients }]),
            ]}
        />
    );
};
