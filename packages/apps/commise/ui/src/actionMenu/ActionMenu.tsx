'use client';

/**
 * @module @commise/ui/action-menu — the web `ActionMenu`: a `⋮` menu button over Radix DropdownMenu. Presentational:
 * the caller supplies every item and what it does.
 *
 * Radix owns the APG Menu Button model §3a requires: Enter / Space / Down open on the first item and Up on the last;
 * Down / Up / Home / End move item focus; Escape and an outside press close the menu and return focus to the trigger.
 * The trigger is 44 × 44 px (spec §3a, 2.5.8), and each item is a 44 px target too.
 *
 * - A chosen item is held by its key, and runs from `onCloseAutoFocus`, which Radix fires once the menu has unmounted:
 *   the host's handler for that key AT THAT MOMENT, or nothing if the host no longer offers it. The snapshot below
 *   decides only what the open menu shows; a handler from the opening closes over a draft that may have moved on since,
 *   and running it would write that stale draft back over another row's commit. Focus goes back to the trigger first, so a dialog the item opens records the trigger as the place to return to
 *   (`docs/design/ingredientSpecialization.md` §S7, web; `docs/design/rowEditorOpenDecisions.md` item 8, web).
 *   ⚠️ The native leaf does not visit the trigger when an item was chosen (`rowEditorBlueprint.md` decision 5): there
 *   the cursor would announce the trigger and then the next sheet back to back. On web the dialog's focus return
 *   (`useReturnFocusOnClose`) is the reason the trigger is visited.
 * - ⛔ No transition classes, so `prefers-reduced-motion` has nothing to suppress.
 *
 * One ref, for what has no declarative form: the trigger, for `.focus()` on a host's focus request and before a held
 * item runs.
 *
 * @pattern Adapter over `@radix-ui/react-dropdown-menu`
 * @pattern Command — the chosen item is held and executed after the menu's dismissal
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useEffectEvent, useRef, useState, type FC } from 'react';

import { BUSY_CONTROL_CLASS } from '../button/busyControlProps.js';
import type { ActionMenuItem, ActionMenuProps } from './props.js';

const ITEM_TONE: Readonly<Record<NonNullable<ActionMenuItem['tone']>, string>> = {
    default: 'text-charcoal',
    destructive: 'text-error-dark',
};

/** The row-actions menu. */
export const ActionMenu: FC<ActionMenuProps> = ({
    triggerLabel,
    items,
    focusRequested = false,
    onFocusRequestHandled,
    unavailable = false,
}) => {
    const [open, setOpen] = useState(false);
    // The items the open menu shows: the list as it was when the menu opened.
    const [shown, setShown] = useState(items);
    // The chosen item's key, waiting for the menu to go.
    const [heldKey, setHeldKey] = useState<string | undefined>(undefined);
    const triggerNode = useRef<HTMLButtonElement>(null);
    // The acknowledgement is not a dependency: a host's new callback must not re-run a request already taken.
    const acknowledgeFocusRequest = useEffectEvent(() => onFocusRequestHandled?.());

    useEffect(() => {
        if (!focusRequested) {
            return;
        }

        triggerNode.current?.focus();
        acknowledgeFocusRequest();
    }, [focusRequested]);

    const onOpenChange = (next: boolean): void => {
        if (next && (unavailable || heldKey !== undefined)) {
            return;
        }

        if (next) {
            setShown(items);
        }

        setOpen(next);
    };

    return (
        <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
            <DropdownMenu.Trigger
                ref={triggerNode}
                aria-label={triggerLabel}
                aria-disabled={unavailable || undefined}
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-charcoal transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam ${BUSY_CONTROL_CLASS}`}
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
                    onCloseAutoFocus={(event) => {
                        if (heldKey === undefined) {
                            return;
                        }

                        event.preventDefault();
                        triggerNode.current?.focus();
                        setHeldKey(undefined);
                        items.find((item) => item.key === heldKey)?.onSelect();
                    }}
                    className="z-50 min-w-[12rem] rounded-2xl bg-card p-1 shadow-lg"
                >
                    {shown.map((item) => (
                        <DropdownMenu.Item
                            key={item.key}
                            onSelect={() => setHeldKey(item.key)}
                            className={`flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-body-sm outline-none data-[highlighted]:bg-pearl ${ITEM_TONE[item.tone ?? 'default']}`}
                        >
                            {item.label}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
