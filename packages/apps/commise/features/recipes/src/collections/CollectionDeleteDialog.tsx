'use client';

/**
 * @module @commise/features-recipes/collections — the web confirmation before a collection is deleted
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2). Delete keeps a dialog because it cannot be undone: "Delete {name}?", "The
 * {n} recipes stay in your library.", **Delete collection** (filled, error) and **Keep collection** (secondary). Focus
 * opens on Keep, and every dismissal route keeps the collection. A failed delete is said in the dialog, which stays open.
 *
 * Presentational: it sends nothing; the host runs the delete.
 *
 * @pattern Adapter over the design-system `ConfirmDialog`
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { FC } from 'react';

import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
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
