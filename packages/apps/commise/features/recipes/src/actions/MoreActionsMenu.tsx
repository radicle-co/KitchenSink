'use client';

/**
 * @module @commise/features-recipes — the web "More actions" overflow on the recipe detail (C4 wireframe parity).
 *
 * The owner's SECONDARY actions (version history, visibility, delete) behind one `⋯` trigger named for the recipe;
 * Edit stays the always-visible primary outside it. The panel is the design system's Popover — portaled, and
 * collision-aware against the page's chrome, so at a phone width it opens clear of the shell's bottom tab bar
 * instead of under it (finding D2) — and the destructive action is a structural slot drawn last, after a divider.
 *
 * ⚠️ The panel is a non-modal `dialog`, not a `menu`: its content is links, buttons and the visibility radio group,
 * and `role="menu"` around that content (what this leaf used to claim) promised a roving-focus model it did not and
 * could not provide. Ordinary Tab order reaches every action. Turning visibility into menu items is the detail
 * redesign of slice 6, which needs a ruling on what a cook without the premium plan is offered.
 *
 * @pattern Composite — the panel lays out the caller's actions and owns where the destructive one goes
 */
import { useMessages } from '@commise/i18n/react';
import { Popover } from '@commise/ui/popover';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { MoreActionsMenuProps } from './model.js';

export const MoreActionsMenu: FC<MoreActionsMenuProps> = ({ recipeTitle, children, destructive }) => {
    const { moreMenu } = useMessages(recipeActionMessages);

    return (
        <Popover
            triggerLabel={fillTemplate(moreMenu.triggerFor, { title: recipeTitle })}
            triggerIcon="ellipsis"
            title={moreMenu.title}
            closeLabel={moreMenu.close}
        >
            <div className="flex flex-col items-start gap-2 pt-2">
                {children}
                {destructive === undefined ? null : (
                    <>
                        <hr className="my-1 w-full border-line-divider" />
                        {destructive}
                    </>
                )}
            </div>
        </Popover>
    );
};
