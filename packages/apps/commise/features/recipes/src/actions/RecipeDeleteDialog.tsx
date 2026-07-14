/**
 * @module @commise/features-recipes — web recipe delete-confirmation dialog (T068 building block).
 *
 * Controlled, presentational confirmation modal. Renders nothing while `open` is false; when open it is an
 * accessible `alertdialog` that names the recipe and offers cancel/confirm. `deleting` disables the confirm
 * action and marks it busy so an in-flight delete cannot be double-submitted. It performs NO mutation — the
 * composing app wires the delete mutation to `onConfirm`.
 */
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

export const RecipeDeleteDialog: FC<RecipeDeleteDialogProps> = ({
    recipeTitle,
    open,
    deleting = false,
    onConfirm,
    onCancel,
}) => {
    const { deleteDialog } = useMessages(recipeActionMessages);
    const titleId = useId();
    const bodyId = useId();

    if (!open) {
        return null;
    }

    return (
        <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
            <h2 id={titleId}>{deleteDialog.title}</h2>
            <p id={bodyId}>{fillTemplate(deleteDialog.body, { title: recipeTitle })}</p>
            <button type="button" onClick={onCancel}>
                {deleteDialog.cancel}
            </button>
            <button type="button" onClick={onConfirm} disabled={deleting} aria-busy={deleting || undefined}>
                {deleteDialog.confirm}
            </button>
            {deleting && <span role="status">{deleteDialog.deletingLabel}</span>}
        </div>
    );
};
