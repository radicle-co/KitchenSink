'use client';

/**
 * @module @commise/features-recipes/collections — the collection's ⋯ menu, drawn once for both platforms and both homes: the
 * web header (beside Add recipes) and the native pinned bar (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §7). One
 * trigger named for the collection ("More actions for {name}"), then Rename · Make private / Make public · Save a copy ·
 * Pull updates (copies only) · divider · Delete collection (a sheet on native).
 *
 * Presentational: props → JSX over the design system's `ActionMenu`, which resolves to its web or native leaf. It sends
 * nothing; the entries come from `collectionMenuItems`, and the host's session supplies each action
 * (`collectionMenuPropsOf`).
 *
 * @pattern Adapter over the design system's `ActionMenu` — the entries come from `collectionMenuItems`
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { collectionMenuItems, type CollectionMoreMenuProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

/** The collection's ⋯ menu. */
export const CollectionMoreMenu: FC<CollectionMoreMenuProps> = ({
    name,
    visibility,
    isCopy,
    onRename,
    onToggleVisibility,
    onSaveCopy,
    onPullUpdates,
    onDelete,
}) => {
    const { menu: copy } = useMessages(collectionMessages);
    const items = collectionMenuItems({
        copy,
        visibility,
        isCopy,
        actions: {
            onRename,
            onSaveCopy,
            onPullUpdates,
            ...(onToggleVisibility === undefined ? {} : { onToggleVisibility }),
        },
    });

    return (
        <ActionMenu
            triggerLabel={fillTemplate(copy.moreActions, { name })}
            title={name}
            closeLabel={copy.close}
            items={items}
            destructiveItem={{ id: 'delete', label: copy.delete, icon: 'trash', onSelect: onDelete }}
        />
    );
};
