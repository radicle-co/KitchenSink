/**
 * @module @commise/features-recipes/collections — the native confirmation before a collection is deleted, the twin of the
 * web leaf (`docs/design/uiOverhaul/buildSpec.md` §5.2): "Delete {name}?", "The {n} recipes stay in your library.",
 * **Delete collection** and **Keep collection**, with the cursor opening on Keep and every dismissal route keeping the
 * collection. A failed delete is said in the dialog, which stays open.
 *
 * Presentational: it sends nothing; the host runs the delete.
 *
 * @pattern Adapter over the design-system `ConfirmDialog`
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { FC } from 'react';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import type { CollectionDeleteDialogProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionDeleteDialog: FC<CollectionDeleteDialogProps> = ({
    open,
    name,
    recipeCount,
    busy,
    failed,
    onConfirm,
    onKeep,
}) => {
    const { dialogs } = useMessages(collectionMessages);
    const locale = useLocale();

    return (
        <ConfirmDialog
            open={open}
            title={fillTemplate(dialogs.deleteTitle, { name })}
            body={formatRecipeCount(
                recipeCount,
                { one: dialogs.deleteBodyOne, other: dialogs.deleteBodyOther },
                locale,
            )}
            confirm={{ label: dialogs.deleteConfirm, icon: 'trash' }}
            keep={{ label: dialogs.deleteKeep, icon: 'x' }}
            busy={busy}
            busyLabel={dialogs.deleting}
            {...(failed ? { error: dialogs.deleteFailed } : {})}
            onConfirm={onConfirm}
            onKeep={onKeep}
        />
    );
};
