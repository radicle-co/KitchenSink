/**
 * @module @commise/features-recipes — the native create entry (build spec §3.4; owner decision D4): the floating "New
 * recipe" `CreateFab`, which opens the empty editor in ONE tap. Paste lives in the editor's Ingredients section, so
 * there is no menu. Native has no sidebar, so the floating form is its only form and `appearance` is not read.
 */
import { useMessages } from '@commise/i18n/react';
import { CreateFab } from '@commise/ui/create-fab';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeCreateButtonProps } from './createButtonProps.js';

/** "New recipe": one tap opens the editor. */
export const RecipeCreateButton: FC<RecipeCreateButtonProps> = ({ onCreateRecipe, firstRun }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <CreateFab
            label={list.createCta}
            icon="plus"
            onPress={onCreateRecipe}
            {...(firstRun === undefined ? {} : { firstRun })}
        />
    );
};
