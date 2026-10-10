'use client';

/**
 * @module @commise/features-recipes — web recipe-list LOAD-ERROR fallback (presentational): what the list's error
 * boundary renders when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 *
 * It keeps the create button: creating a recipe does not depend on this read, and this body has no create CTA to replace
 * it, so hiding it would leave Try again as the only action (see `shouldShowCreateButton`).
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeCreateButton } from './RecipeCreateButton.js';
import type { RecipeListLoadErrorProps } from './model.js';

export const RecipeListLoadError: FC<RecipeListLoadErrorProps> = ({ onRetry, onCreateRecipe }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <>
            <div role="alert" className="flex flex-col items-start gap-3 py-6">
                <p className="text-body text-ink">{list.errorTitle}</p>
                <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                    {list.retry}
                </Button>
            </div>
            <RecipeCreateButton onCreateRecipe={onCreateRecipe} />
        </>
    );
};
