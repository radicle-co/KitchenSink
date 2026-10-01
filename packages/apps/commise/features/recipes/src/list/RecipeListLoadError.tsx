'use client';

/**
 * @module @commise/features-recipes — web recipe-list LOAD-ERROR fallback (presentational): what the list's error
 * boundary renders when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 *
 * It keeps the create dial: creating a recipe does not depend on this read, and this body has no create CTA to replace
 * it, so hiding it would leave Try again as the only action (see `shouldShowCreateDial`).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeCreateDial } from './RecipeCreateDial.js';
import type { RecipeListLoadErrorProps } from './model.js';

export const RecipeListLoadError: FC<RecipeListLoadErrorProps> = ({ onRetry, onCreateRecipe, onPasteIngredients }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <>
            <div role="alert">
                <p>{list.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {list.retry}
                </button>
            </div>
            <RecipeCreateDial onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />
        </>
    );
};
