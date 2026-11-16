/**
 * @module @commise/features-recipes/detail — the dialogs only a recipe's owner meets: the Premium sheet for a Private
 * they may not have, the make-public confirm, the source-statement sheet, and the delete confirm. Written once; the leaves are platform pairs, so
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
import { SourceStatementSheet } from '../actions/SourceStatementSheet.js';
import type { SourceStatementSheetProps } from '../actions/sourceStatementSheetProps.js';
import { PrivateFoodsRefusalSheet } from '../editor/PrivateFoodsRefusalSheet.js';
import type { PrivateFoodsRefusalSheetProps } from '../editor/privateFoodsRefusalSheetProps.js';

/** Props for {@link RecipeDetailDialogs}: what `useRecipeDetailController` decided. */
export interface RecipeDetailDialogsProps {
    /** Only the owner meets the Premium, make-public and delete dialogs. */
    readonly viewerIsOwner: boolean;
    readonly recipeTitle: string;
    readonly upsell: RecipeUpsellSheetProps;
    readonly makePublic: RecipeMakePublicDialogProps;
    /** "Where is this recipe from?", asked before a recipe that owes a statement goes public (ADR-0092). */
    readonly statement: SourceStatementSheetProps;
    readonly delete: Omit<RecipeDeleteDialogProps, 'recipeTitle'>;
    /**
     * A Make public the server refused because a line uses a food only the cook can see (private foods spec F3): the lines
     * named, with the only ways that work (change them, or ask to make each food public). Absent when nothing was refused.
     */
    readonly privateFoods?: Pick<PrivateFoodsRefusalSheetProps, 'lines' | 'onOpenFood' | 'onClose'>;
}

/** The owner-only dialogs of the recipe page: presentational, props → JSX. */
export const RecipeDetailDialogs: FC<RecipeDetailDialogsProps> = ({
    viewerIsOwner,
    recipeTitle,
    upsell,
    makePublic,
    statement,
    delete: deleteDialog,
    privateFoods,
}) => {
    if (!viewerIsOwner) {
        return null;
    }

    return (
        <>
            <RecipeUpsellSheet {...upsell} />
            <RecipeMakePublicDialog {...makePublic} />
            <SourceStatementSheet {...statement} />
            <RecipeDeleteDialog recipeTitle={recipeTitle} {...deleteDialog} />
            {privateFoods === undefined ? null : (
                <PrivateFoodsRefusalSheet
                    open
                    door="makePublic"
                    canGoPrivate={false}
                    onSendAsPrivate={() => undefined}
                    {...privateFoods}
                />
            )}
        </>
    );
};
