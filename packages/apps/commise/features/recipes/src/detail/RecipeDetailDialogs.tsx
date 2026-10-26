/**
 * @module @commise/features-recipes/detail — the three dialogs only a recipe's owner meets (and, for anyone, the refusal of a copy): the Premium sheet for a Private
 * they may not have, the make-public confirm, and the delete confirm. Written once; the leaves are platform pairs, so
 * the bundler resolves each to its web or native form. Each app places the result where its page wants it (web: beside
 * the page; mobile: in the view's scroll footer).
 *
 * ⛔ None of them lives in the ⋯ menu: they are siblings of it, so they survive the menu closing while they are open.
 */
import type { FC } from 'react';

import { RecipeDeleteDialog } from '../actions/RecipeDeleteDialog.js';
import { RecipeMakePublicDialog } from '../actions/RecipeMakePublicDialog.js';
import type {
    RecipeDeleteDialogProps,
    RecipeMakePublicDialogProps,
    RecipeSaveCopyNoSlotProps,
    RecipeUpsellSheetProps,
} from '../actions/model.js';
import { RecipeSaveCopyNoSlot } from '../actions/RecipeSaveCopyNoSlot.js';
import { RecipeUpsellSheet } from '../actions/RecipeUpsellSheet.js';

/** Props for {@link RecipeDetailDialogs}: what `useRecipeDetailController` decided. */
export interface RecipeDetailDialogsProps {
    /** Only the owner meets the Premium, make-public and delete dialogs. */
    readonly viewerIsOwner: boolean;
    readonly recipeTitle: string;
    readonly upsell: RecipeUpsellSheetProps;
    readonly makePublic: RecipeMakePublicDialogProps;
    readonly delete: Omit<RecipeDeleteDialogProps, 'recipeTitle'>;
    /** The refusal of a copy with no private slot to land in. Shown to whoever pressed Save a copy, owner or not. */
    readonly cloneRefusal: RecipeSaveCopyNoSlotProps;
}

/** The owner-only dialogs of the recipe page: presentational, props → JSX. */
export const RecipeDetailDialogs: FC<RecipeDetailDialogsProps> = ({
    viewerIsOwner,
    recipeTitle,
    upsell,
    makePublic,
    delete: deleteDialog,
    cloneRefusal,
}) => {
    if (!viewerIsOwner) {
        // Save a copy is another cook's action, so its refusal is the one dialog they can meet.
        return <RecipeSaveCopyNoSlot {...cloneRefusal} />;
    }

    return (
        <>
            <RecipeSaveCopyNoSlot {...cloneRefusal} />
            <RecipeUpsellSheet {...upsell} />
            <RecipeMakePublicDialog {...makePublic} />
            <RecipeDeleteDialog recipeTitle={recipeTitle} {...deleteDialog} />
        </>
    );
};
