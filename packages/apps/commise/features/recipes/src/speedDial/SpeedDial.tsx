'use client';

/**
 * @module @commise/features-recipes — the web SpeedDial FAB (U34, owner ruling 2026-08-25).
 *
 * The floating create control, as a MENU BUTTON: the same pinned FAB a cook already presses, which now
 * discloses the creation destinations instead of running the only one. Exactly one destination is wired
 * today; Scan / Import / AI belong to features 004 and 005 and are **not rendered at all** — not disabled,
 * not "coming soon" — because promising a stopped feature is worse than omitting it.
 *
 * PATTERN — Menu Button (WAI-ARIA disclosure) implemented as an **Adapter** over `@radix-ui/react-dialog`,
 * which is already a dependency of this package. The library owns everything a menu owes a keyboard user
 * that is hard to get right, and each of these was read out of the installed source rather than assumed:
 *
 *   - **focus trap** — `Dialog.Content` passes `trapped: trapFocus` to `FocusScope`;
 *   - **focus RESTORATION to the trigger** — the modal content's own `onCloseAutoFocus` calls
 *     `event.preventDefault()` then `context.triggerRef.current?.focus()`, so Escape, an outside press and
 *     an item activation all land the caret back on the FAB rather than on `<body>`;
 *   - **Escape and outside-pointer dismissal** — `DismissableLayer`, with `disableOutsidePointerEvents`;
 *   - **the rest of the page hidden from assistive tech** — `hideOthers(content)`.
 *
 * Only two things are supplied here, because the library supplies neither: the MENU semantics (Radix emits
 * `role="dialog"` / `aria-haspopup="dialog"` BEFORE spreading consumer props, so both override cleanly, and
 * it emits no `aria-modal` that would be invalid on a `role="menu"`), and arrow navigation between
 * destinations, whose arithmetic lives in the pure `./model.js`.
 *
 * ⛔ The flip condition, recorded so it is not re-litigated: `@radix-ui/react-dropdown-menu` is the right
 * component the day a SECOND destination is real, because typeahead and true roving focus are then owed. It
 * is not installed, and installing it to render one item would be the heavier answer. Reach for it then;
 * do not grow the handler below instead.
 *
 * ⚠️ Anything outside `Dialog.Content` is `aria-hidden` while the dial is open, which is why the scrim is
 * decorative and carries no label: on this platform there is no such thing as a labelled dismiss surface
 * outside the content. Native's backdrop IS a real tap target and does carry one.
 */
import { EnterTransition } from '@commise/ui/motion';
import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState, type FC, type KeyboardEvent } from 'react';

import { PlusIcon } from '../form/icons.js';
import { nextMenuIndex, openIndexForTriggerKey, type SpeedDialProps } from './model.js';

export const SpeedDial: FC<SpeedDialProps> = ({ triggerLabel, menuLabel, actions }) => {
    const [open, setOpen] = useState(false);
    // Which destination owns the roving `tabIndex={0}` — and, on open, which one receives focus.
    const [focusIndex, setFocusIndex] = useState(0);
    // Refs on the item buttons are the sanctioned kind: focus is an imperative, non-declarative browser
    // system with no props equivalent.
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const focusItem = (index: number): void => {
        setFocusIndex(index);
        itemRefs.current[index]?.focus();
    };

    const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        const index = openIndexForTriggerKey(event.key, actions.length);

        if (index === undefined) {
            return;
        }

        // Enter and Space are absent from that decision on purpose — the trigger is a real `<button>` and
        // already synthesises a click from both, which `Dialog.Trigger` turns into the open toggle.
        event.preventDefault();
        setFocusIndex(index);
        setOpen(true);
    };

    const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const index = nextMenuIndex(event.key, focusIndex, actions.length);

        if (index === undefined) {
            return;
        }

        event.preventDefault();
        focusItem(index);
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            {/* The offset is DERIVED, not hardcoded — inherited verbatim from the FAB this replaces. It
                clears the narrow-breakpoint bottom nav plus the device safe-area inset, and drops to the base
                offset once that nav becomes a desktop sidebar at the shared `lg` cutover. It lives on the
                anchor (rather than on the button) so the menu can be positioned against the SAME expression
                instead of a second copy of it. */}
            <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 lg:bottom-8">
                {/* Decorative scrim only: dismissal is owned by the dismissable layer, and `hideOthers`
                    already hides this from assistive tech. `bg-charcoal/20` is Tailwind's alpha syntax, not
                    a decimal `rgba(...)` literal. */}
                <Dialog.Overlay className="fixed inset-0 -z-10 bg-charcoal/20" />
                <Dialog.Trigger
                    aria-label={triggerLabel}
                    aria-haspopup="menu"
                    onKeyDown={onTriggerKeyDown}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-seafoam text-white shadow-lg transition hover:bg-ocean-dark"
                >
                    {/* An SVG, not the text "+": flex centres the LINE BOX but ink is placed by the BASELINE,
                        so a "+" character paints ~1.7px low and no centring property can correct it. This
                        glyph's extents are symmetric about the viewBox centre, matching the mockup. */}
                    <PlusIcon className="size-6" />
                </Dialog.Trigger>
                <EnterTransition>
                    <Dialog.Content
                        role="menu"
                        aria-label={menuLabel}
                        onKeyDown={onMenuKeyDown}
                        // Radix would otherwise focus the content itself; the dial opens ONTO a destination,
                        // and which one depends on whether the caller arrowed up or down into it.
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            itemRefs.current[focusIndex]?.focus();
                        }}
                        // The DS hairline (`border-border`), matching the sibling `MoreActionsMenu` panel.
                        className="absolute bottom-full right-0 mb-3 flex min-w-48 flex-col items-stretch gap-1 rounded-2xl border border-border bg-card p-2 shadow-lg"
                    >
                        {actions.map((action, index) => (
                            <button
                                key={action.id}
                                ref={(node) => {
                                    itemRefs.current[index] = node;
                                }}
                                type="button"
                                role="menuitem"
                                // Roving tabindex: exactly one destination is tabbable, so the focus trap
                                // cycles within the menu instead of walking a list the arrows already own.
                                tabIndex={index === focusIndex ? 0 : -1}
                                onClick={() => {
                                    setOpen(false);
                                    action.onSelect();
                                }}
                                className="min-h-11 whitespace-nowrap rounded-xl px-4 py-2 text-left text-body-sm font-medium text-charcoal transition hover:bg-pearl focus-visible:bg-pearl"
                            >
                                {action.label}
                            </button>
                        ))}
                    </Dialog.Content>
                </EnterTransition>
            </div>
        </Dialog.Root>
    );
};
