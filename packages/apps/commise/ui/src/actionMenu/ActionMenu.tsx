'use client';

/**
 * @module @commise/ui/action-menu — the web `ActionMenu`: a `⋯` menu button over Radix DropdownMenu. Presentational:
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
 * - The destructive action is drawn last, after a separator, in the danger label (§1.11).
 * - The menu keeps clear of the page's chrome: it reads the page's `PopupInsetsContext` reader as it opens and hands
 *   Radix the bar's extent as collision padding, so with no room below it flips above (spec §1.11, finding D2).
 * - ⛔ No transition classes, so `prefers-reduced-motion` has nothing to suppress.
 *
 * One ref, for what has no declarative form: the trigger, for `.focus()` on a host's focus request and before a held
 * item runs.
 *
 * @pattern Adapter over `@radix-ui/react-dropdown-menu`
 * @pattern Command — the chosen item is held and executed after the menu's dismissal
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useContext, useRef, useState, type FC } from 'react';

import { BUSY_CONTROL_CLASS } from '../button/busyControlProps.js';
import { Icon } from '../icon/Icon.js';
import { PopupInsetsContext, type PopupInsets } from '../popupInsets/popupInsetsContext.js';
import { actionNamed, type ActionMenuItem, type ActionMenuProps, type ActionMenuSnapshot } from './props.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

/** The space the menu keeps from the viewport's edge, and from the page's chrome. */
const EDGE = 8;

/** An item: a 44 px row, highlighted in `pearl`. */
const ITEM =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-body outline-none data-[highlighted]:bg-ink/6';

/** One menu item: its glyph and label, in the tone of its place in the menu. */
const MenuItem: FC<{
    readonly item: ActionMenuItem;
    readonly tone: 'text-ink' | 'text-danger-text';
    readonly onChoose: (id: string) => void;
}> = ({ item, tone, onChoose }) => (
    <DropdownMenu.Item onSelect={() => onChoose(item.id)} className={`${ITEM} ${tone}`}>
        {item.icon === undefined ? null : <Icon name={item.icon} size={20} />}
        {item.label}
    </DropdownMenu.Item>
);

/** The row-actions menu. */
export const ActionMenu: FC<ActionMenuProps> = ({
    triggerLabel,
    items,
    destructiveItem,
    focusRequested = false,
    onFocusRequestHandled,
    unavailable = false,
}) => {
    const [open, setOpen] = useState(false);
    // What the open menu shows: the actions as they were when the menu opened.
    const [shown, setShown] = useState<ActionMenuSnapshot>({ items, destructiveItem });
    // The page's chrome as it was when the menu opened.
    const readInsets = useContext(PopupInsetsContext);
    const [insets, setInsets] = useState<PopupInsets>({ top: 0, bottom: 0 });
    // The chosen item's key, waiting for the menu to go.
    const [heldKey, setHeldKey] = useState<string | undefined>(undefined);
    const triggerNode = useRef<HTMLButtonElement>(null);
    useFocusRequest(focusRequested, () => triggerNode.current?.focus(), onFocusRequestHandled);

    const onOpenChange = (next: boolean): void => {
        if (next && (unavailable || heldKey !== undefined)) {
            return;
        }

        if (next) {
            setShown({ items, destructiveItem });
            setInsets(readInsets());
        }

        setOpen(next);
    };

    return (
        <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
            <DropdownMenu.Trigger
                ref={triggerNode}
                aria-label={triggerLabel}
                aria-disabled={unavailable || undefined}
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${BUSY_CONTROL_CLASS}`}
            >
                <Icon name="ellipsis" size={24} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    collisionPadding={{ top: insets.top + EDGE, bottom: insets.bottom + EDGE, left: EDGE, right: EDGE }}
                    onCloseAutoFocus={(event) => {
                        if (heldKey === undefined) {
                            return;
                        }

                        event.preventDefault();
                        triggerNode.current?.focus();
                        setHeldKey(undefined);
                        actionNamed(items, destructiveItem, heldKey)?.onSelect();
                    }}
                    className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[12rem] overflow-y-auto rounded-lg bg-paper-overlay p-1 shadow-lg"
                >
                    {shown.items.map((item) => (
                        <MenuItem key={item.id} item={item} tone="text-ink" onChoose={setHeldKey} />
                    ))}
                    {shown.destructiveItem === undefined ? null : (
                        <>
                            <DropdownMenu.Separator className="my-1 h-px bg-line-divider" />
                            <MenuItem item={shown.destructiveItem} tone="text-danger-text" onChoose={setHeldKey} />
                        </>
                    )}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
