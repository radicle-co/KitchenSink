/**
 * @module @commise/ui/action-menu — the web `ActionMenu`: a `⋮` menu button over Radix DropdownMenu. Presentational:
 * the caller supplies every item and what it does.
 *
 * Radix owns the APG Menu Button model §3a requires: Enter / Space / Down open on the first item and Up on the last;
 * Down / Up / Home / End move item focus; Escape and an outside press close the menu and return focus to the trigger;
 * activating an item runs it and closes the menu. The trigger is 44 × 44 px (spec §3a, 2.5.8), and each item is a
 * 44 px target too.
 *
 * - ⛔ No transition classes, so `prefers-reduced-motion` has nothing to suppress.
 *
 * @pattern Adapter over `@radix-ui/react-dropdown-menu`
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { FC } from 'react';

import type { ActionMenuItem, ActionMenuProps } from './props.js';

const ITEM_TONE: Readonly<Record<NonNullable<ActionMenuItem['tone']>, string>> = {
    default: 'text-charcoal',
    destructive: 'text-error-dark',
};

/** The row-actions menu. */
export const ActionMenu: FC<ActionMenuProps> = ({ triggerLabel, items }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger
            aria-label={triggerLabel}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-charcoal transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam"
        >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
            </svg>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
            <DropdownMenu.Content
                align="end"
                sideOffset={4}
                collisionPadding={8}
                className="z-50 min-w-[12rem] rounded-2xl bg-card p-1 shadow-lg"
            >
                {items.map((item) => (
                    <DropdownMenu.Item
                        key={item.key}
                        onSelect={item.onSelect}
                        className={`flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-body-sm outline-none data-[highlighted]:bg-pearl ${ITEM_TONE[item.tone ?? 'default']}`}
                    >
                        {item.label}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
);
