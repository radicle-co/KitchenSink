'use client';

/**
 * @module @commise/features-recipes/form — `IngredientGroupHeading` (web): a group's heading (build spec §7.5.5), an H3
 * in `label`, `inkMuted`, under the section's H2, with its own `⋯`: Rename group · Add ingredient to this group · Remove
 * group (keep its ingredients). While the group is renamed, its name field takes the heading's place.
 *
 * Presentational: `props → JSX` over the heading's view (`GroupHeadingView`).
 *
 * @pattern Strategy — the heading or its rename field, chosen by the view's `renaming`
 */
import { ActionMenu } from '@commise/ui/action-menu';
import type { FC } from 'react';

import { GroupNameField } from './GroupNameField.js';
import type { GroupHeadingView } from './useIngredientGroups.js';

/** A group's heading, or its rename field. */
export const IngredientGroupHeading: FC<{ readonly id: string; readonly group: GroupHeadingView }> = ({ id, group }) =>
    group.renaming === undefined ? (
        <div className="flex min-h-11 items-center justify-between gap-2">
            <h3 id={id} className="min-w-0 break-words text-label text-ink-muted">
                {group.label}
            </h3>
            <ActionMenu
                triggerLabel={group.actionsLabel}
                title={group.label}
                closeLabel={group.closeLabel}
                items={group.actions}
                destructiveItem={group.destructiveAction}
                focusRequested={group.actionsFocus.requested}
                onFocusRequestHandled={group.actionsFocus.onHandled}
            />
        </div>
    ) : (
        <GroupNameField field={group.renaming} />
    );
