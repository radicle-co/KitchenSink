'use client';

/**
 * @module @commise/features-recipes — web recipe-list CREATE DIAL (presentational).
 *
 * The pinned FAB that DISCLOSES the creation destinations (U34) rather than running the only one — mounted by the
 * settled results and by the load error, so the destination list is spelled once. Plan U9 made good on the shape's
 * purpose: pasting an ingredient list is the SECOND destination, and it cost one list entry rather than a redesign.
 * Scan / Import / AI join the same list when 004 and 005 ship.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { SpeedDial } from '../speedDial/SpeedDial.js';
import type { RecipeCreateDestinations } from './model.js';

export const RecipeCreateDial: FC<RecipeCreateDestinations> = ({ onCreateRecipe, onPasteIngredients }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <SpeedDial
            triggerLabel={list.createCta}
            menuLabel={list.createMenuLabel}
            // ⚠️ Built with a spread rather than a ternary over two whole arrays: `SpeedDialProps.actions` is a
            // NON-EMPTY tuple, so the scratch entry has to stay in first position by construction for the type to hold.
            actions={[
                { id: 'scratch', label: list.createFromScratch, onSelect: onCreateRecipe },
                ...(onPasteIngredients === undefined
                    ? []
                    : [{ id: 'paste', label: list.createFromPaste, onSelect: onPasteIngredients }]),
            ]}
        />
    );
};
