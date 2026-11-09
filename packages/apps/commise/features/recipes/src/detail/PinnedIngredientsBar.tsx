'use client';

/**
 * @module @commise/features-recipes — the web pinned ingredients bar and the list it opens (owner ruling R1,
 * `docs/plans/2026-11-08-pinnedIngredientsBar.md`; boards `RecipeDetailScrolledMobile` and
 * `RecipeDetailIngredientsOpenMobile`).
 *
 * Below a 720 px body, once the ingredients card has scrolled above the top of the window, ONE button pins at the top:
 * "Ingredients for 4 / 13 items · 1 ticked / Show". It opens the list as a panel directly under it, over a scrim, with the
 * page behind it held still. The bar has no stepper (a mistap must never rescale a recipe mid-cook); the stepper is the
 * first row of the list. From 720 the sticky card does this job, so the whole thing is `hidden` by the article's
 * container query and the bar never draws.
 *
 * A non-modal dialog, kept by hand because the bar must stay pressable above its own panel: focus moves into the list on
 * open and back to the bar on close, Tab wraps between the bar and the list, Escape and the scrim close it.
 *
 * @pattern Adapter over the DOM focus and scroll APIs — `.focus()` and the document's scroll lock have no declarative form.
 */
import { Icon } from '@commise/ui/icon';
import { enterTransitionClassName } from '@commise/ui/motion';
import { useEffect, useRef, type FC, type ReactNode } from 'react';

import type { PinnedBarFacts } from './pinnedBarFacts.js';

/** What the Tab key can land on inside the list. */
const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What {@link PinnedIngredientsBar} draws. */
export interface PinnedIngredientsBarProps {
    readonly facts: PinnedBarFacts;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** The scrim's accessible name. */
    readonly scrimLabel: string;
    /** The list: the servings row and the rows. */
    readonly children: ReactNode;
}

/**
 * The pinned bar, its scrim and its list. Orchestration of its own focus, key and scroll behaviour: whether the list is
 * open is the shell's, handed in as props.
 */
export const PinnedIngredientsBar: FC<PinnedIngredientsBarProps> = ({
    facts,
    open,
    onOpenChange,
    scrimLabel,
    children,
}) => {
    const bar = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(false);

    // @sideEffect Focus goes into the list on open and back to the bar on close.
    useEffect(() => {
        if (open) {
            panel.current?.querySelector<HTMLElement>(TABBABLE)?.focus();
        } else if (wasOpen.current) {
            bar.current?.focus();
        }

        wasOpen.current = open;
    }, [open]);

    // @sideEffect While the list is open: the page behind the scrim does not scroll, Escape closes, and Tab wraps between
    // the bar and the list's controls, so focus never leaves them, and a window grown to a 720 px body closes it.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const { documentElement } = document;
        const before = documentElement.style.overflow;

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onOpenChange(false);

                return;
            }

            if (event.key !== 'Tab' || bar.current === null) {
                return;
            }

            const stops = [bar.current, ...Array.from(panel.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])];
            const at = stops.findIndex((stop) => stop === document.activeElement);
            const next = stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];

            event.preventDefault();
            next?.focus();
        };

        // The window can grow to a 720 px body (a tablet, a rotation, a resize) while the list is open. The article's
        // container query then hides the whole thing, and nothing visible is left to close it or to lift the scroll lock.
        const onResize = (): void => {
            if (bar.current?.getClientRects().length === 0) {
                onOpenChange(false);
            }
        };

        documentElement.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);

        return () => {
            documentElement.style.overflow = before;
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onResize);
        };
    }, [open, onOpenChange]);

    return (
        // `hidden` from a 720 px body: the sticky card does this job there (R2), and the bar never draws.
        <div className="@min-[45rem]/detail:hidden">
            {open && (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={scrimLabel}
                    onClick={() => onOpenChange(false)}
                    className="fixed inset-0 z-30 cursor-default touch-none bg-scrim"
                />
            )}
            <button
                ref={bar}
                type="button"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={facts.name}
                onClick={() => onOpenChange(!open)}
                className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] z-40 flex min-h-16 items-center gap-2.5 rounded-lg bg-paper py-2 pe-3 ps-4 text-start text-ink shadow-[inset_0_0_0_1px_var(--color-line-divider),var(--shadow-lg)]"
            >
                <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
                    <span className="text-label font-semibold">
                        {facts.heading} <span className="font-normal text-ink-muted">{facts.forServings}</span>
                    </span>
                    <span className="text-meta tabular-nums text-ink-muted">{facts.meta}</span>
                </span>
                <span aria-hidden="true" className="text-label font-semibold text-action-text">
                    {facts.cue}
                </span>
                <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-action text-on-action"
                >
                    <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} />
                </span>
            </button>
            {open && (
                <div
                    ref={panel}
                    role="dialog"
                    aria-label={facts.dialogName}
                    className={`fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+5rem)] z-40 max-h-[calc(100dvh-env(safe-area-inset-top,0px)-6rem-var(--bottom-chrome,0px))] overflow-y-auto overscroll-contain rounded-lg bg-paper pb-2.5 shadow-xl ${enterTransitionClassName}`}
                >
                    {children}
                </div>
            )}
        </div>
    );
};
