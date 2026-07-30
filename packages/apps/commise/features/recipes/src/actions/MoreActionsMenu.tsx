'use client';

/**
 * @module @commise/features-recipes — web "More" overflow menu (C4 wireframe parity).
 *
 * A minimal, keyboard-accessible disclosure that groups the recipe-detail header's SECONDARY owner actions
 * (version history, delete, visibility) behind a single trigger, matching the wireframe's `[Edit] [More]`
 * header — Edit stays a primary, always-visible control outside this menu; everything else moves behind it.
 * The panel carries `role="menu"` and the trigger `aria-haspopup="menu"` / `aria-expanded`. Its content mixes
 * true actions (buttons/links) with the visibility radiogroup — not uniform `menuitem`s — so this
 * deliberately does NOT implement full ARIA-menu roving-tabindex/arrow-key navigation, which would conflict
 * with the nested radiogroup's own semantics; every action stays reachable by ordinary Tab order instead.
 *
 * This is intentionally lighter than the Radix `AlertDialog` the delete confirmation uses (see
 * `RecipeDeleteDialog`): a non-modal disclosure needs no focus trap or portal, so hand-rolling open/close +
 * Escape + outside-click stays proportionate to a cosmetic control rather than pulling in a whole menu
 * library. Open/close is local, ephemeral UI state — not business logic — so it is owned here (a headless
 * menu primitive) rather than lifted into the composing container; the component performs no navigation or
 * mutation of its own, it only discloses whatever `children` the caller supplies (Composite/slot pattern).
 */
import { useMessages } from '@commise/i18n/react';
import { buttonSurfaceClass } from '@commise/ui/button';
import { useEffect, useRef, useState, type FC, type KeyboardEvent } from 'react';

import { recipeActionMessages } from './messages.js';
import type { MoreActionsMenuProps } from './model.js';

export const MoreActionsMenu: FC<MoreActionsMenuProps> = ({ children }) => {
    const { moreMenu } = useMessages(recipeActionMessages);
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Outside-click dismiss: only wired while open, and torn down on close/unmount.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const onPointerDown = (event: MouseEvent): void => {
            if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown);

        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
            setOpen(false);
            triggerRef.current?.focus();
        }
    };

    return (
        <div ref={containerRef} className="relative inline-block" onKeyDown={onKeyDown}>
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
                // The DS secondary surface (palette, radius, focus ring, 44px touch floor) via the shared
                // recipe rather than the `Button` COMPONENT: this trigger must own its own `ref` to restore
                // focus on Escape and to scope the outside-click check, and `Button` forwards no ref.
                className={buttonSurfaceClass('secondary')}
            >
                {moreMenu.trigger}
            </button>
            {open && (
                <div
                    role="menu"
                    aria-label={moreMenu.trigger}
                    // The DS hairline (`border-border`), not the off-tier `border-mist`: `mist` is the palette's
                    // divider TONE and every other panel edge in the product spells this token. The popover is
                    // identified by its content and `shadow-lg`, so the rim is decoration under SC 1.4.11.
                    className="absolute right-0 top-full z-10 mt-2 flex min-w-48 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg"
                >
                    {children}
                </div>
            )}
        </div>
    );
};
