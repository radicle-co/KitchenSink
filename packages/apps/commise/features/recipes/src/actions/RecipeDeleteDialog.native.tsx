/**
 * @module @commise/features-recipes — native recipe delete-confirmation dialog (T068 building block; spec §6.5).
 *
 * The recipe's delete confirmation, as the design system's `ConfirmDialog`: it names the recipe, offers "Delete recipe"
 * (the filled destructive tone, `trash`) and "Keep recipe" (where focus opens), spins the confirm while `deleting`, says
 * "Deleting…" politely, and shows a failure inside the dialog (B17). It performs NO mutation — the composing app wires
 * the delete to `onConfirm` — and every close path (Escape, the Keep button) is the one `onCancel`.
 *
 * The screen-reader cursor opens on Keep, and Keep stays enabled while a delete is in flight: if the mutation hangs, a
 * dialog with no way out would trap the cook.
 *
 * @pattern Adapter over the design-system `ConfirmDialog` — the recipe's copy on the house confirmation
 */
import { useMessages } from '@commise/i18n/react';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { FC } from 'react';

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

    return (
        <ConfirmDialog
            open={open}
            title={deleteDialog.title}
            body={fillTemplate(deleteDialog.body, { title: recipeTitle })}
            confirm={{ label: deleteDialog.confirm, icon: 'trash' }}
            keep={{ label: deleteDialog.keep }}
            busy={deleting}
            busyLabel={deleteDialog.deletingLabel}
            {...(error ? { error: deleteDialog.error } : {})}
            onConfirm={onConfirm}
            onKeep={onCancel}
        />
    );
};
