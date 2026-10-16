/**
 * @module @commise/features-recipes/detail — the three dialogs only a recipe's owner meets: the Premium sheet for a Private
 * they may not have, the make-public confirm, and the delete confirm. Written once; the leaves are platform pairs, so
 * the bundler resolves each to its web or native form. Each app places the result where its page wants it (web: beside
 * the page; mobile: in the view's scroll footer).
 *
 * ⛔ None of them lives in the ⋯ menu: they are siblings of it, so they survive the menu closing while they are open.
 */
import type { FC } from 'react';

import { RecipeDeleteDialog } from '../actions/RecipeDeleteDialog.js';
import { RecipeMakePublicDialog } from '../actions/RecipeMakePublicDialog.js';
import type { RecipeDeleteDialogProps, RecipeMakePublicDialogProps, RecipeUpsellSheetProps } from '../actions/model.js';
import { RecipeUpsellSheet } from '../actions/RecipeUpsellSheet.js';

/** Props for {@link RecipeDetailDialogs}: what `useRecipeDetailController` decided. */
export interface RecipeDetailDialogsProps {
    /** Only the owner meets these dialogs; for anyone else this renders nothing. */
    readonly viewerIsOwner: boolean;
    readonly recipeTitle: string;
    readonly upsell: RecipeUpsellSheetProps;
    readonly makePublic: RecipeMakePublicDialogProps;
    readonly delete: Omit<RecipeDeleteDialogProps, 'recipeTitle'>;
}

/** The owner-only dialogs of the recipe page. */
export const RecipeDetailDialogs: FC<RecipeDetailDialogsProps> = ({
    viewerIsOwner,
    recipeTitle,
    upsell,
    makePublic,
    delete: deleteDialog,
}) => {
    if (!viewerIsOwner) {
        return null;
    }

    return (
        <>
            <RecipeUpsellSheet {...upsell} />
            <RecipeMakePublicDialog {...makePublic} />
            <RecipeDeleteDialog recipeTitle={recipeTitle} {...deleteDialog} />
        </>
    );
};
