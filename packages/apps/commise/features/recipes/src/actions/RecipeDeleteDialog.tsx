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
    error = false,
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4">
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={bodyId}
                className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-card p-6 shadow-lg"
            >
                <h2 id={titleId} className="font-display text-heading-lg font-semibold text-charcoal">
                    {deleteDialog.title}
                </h2>
                <p id={bodyId} className="text-body-md leading-relaxed text-slate">
                    {fillTemplate(deleteDialog.body, { title: recipeTitle })}
                </p>
                <div className="flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl"
                    >
                        {deleteDialog.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        aria-busy={deleting || undefined}
                        className="rounded-full bg-error px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                    >
                        {deleteDialog.confirm}
                    </button>
                </div>
                {deleting && (
                    <span role="status" className="text-body-sm text-slate">
                        {deleteDialog.deletingLabel}
                    </span>
                )}
                {error && !deleting && (
                    <p role="alert" className="text-body-sm text-error">
                        {deleteDialog.error}
                    </p>
                )}
            </div>
        </div>
    );
};
