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
 * A MODAL dialog on Radix. The bar in the page is the trigger; while the list is open the dialog's content draws a second
 * copy of the bar, at the same fixed position above the scrim, as the close button, so the bar stays pressable above its
 * own panel. The bar copy and the panel share one frame capped at half the window (`pinnedOverlayLimit`), so the panel
 * takes what the bar leaves and the list scrolls inside it. Radix owns Escape, the scroll lock, hiding the page
 * behind, the Tab loop and the focus return to the trigger.
 *
 * @pattern Adapter over @radix-ui/react-dialog — the bar is the trigger and, open, the close button of the same dialog.
 */
import { Icon } from '@commise/ui/icon';
import { enterTransitionClassName } from '@commise/ui/motion';
import { surfaceToneClass } from '@commise/ui/surface-tone';
import * as Dialog from '@radix-ui/react-dialog';
import type { FC, ReactNode } from 'react';

import type { PinnedBarFacts } from './pinnedBarFacts.js';
import { PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME } from './pinnedOverlayLimit.js';

/** What {@link PinnedIngredientsBar} draws. */
export interface PinnedIngredientsBarProps {
    readonly facts: PinnedBarFacts;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** The list: the servings row and the rows. */
    readonly children: ReactNode;
}

/**
 * The bar's face, shared by the trigger in the page and the close button over the scrim. It sets NO width: the trigger is
 * `fixed` with an inset on each side, and a width on top of those would push its right edge past the window.
 */
const BAR_FACE = `flex min-h-16 items-center gap-2.5 rounded-lg ${surfaceToneClass('paper')} py-2 pe-3 ps-4 text-start text-ink shadow-[inset_0_0_0_1px_var(--color-line-divider),var(--shadow-lg)]`;

/** Where the bar sits: pinned under the top chrome. */
const BAR_PLACE = 'fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.5rem)]';

/** The open list's panel: a flex child of the capped frame, scrolling inside itself, with no cap or offset. */
const PANEL_CLASS_NAME = [
    'min-h-0 overflow-y-auto overscroll-contain rounded-lg',
    surfaceToneClass('paper'),
    'pb-2.5 shadow-xl outline-none',
    enterTransitionClassName,
].join(' ');

/** What the bar says, drawn inside either button; the button's name already says it (SC 2.5.3). */
const BarContent: FC<{ readonly facts: PinnedBarFacts; readonly open: boolean }> = ({ facts, open }) => (
    <>
        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
            <span className="text-body font-semibold">
                {facts.heading} <span className="text-meta font-normal text-ink-muted">{facts.forServings}</span>
            </span>
            <span className="text-meta tabular-nums text-ink-muted">{facts.meta}</span>
        </span>
        <span aria-hidden="true" className="text-body font-semibold text-action-text">
            {facts.cue}
        </span>
        <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-action text-on-action"
        >
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} />
        </span>
    </>
);

/** The pinned bar, its scrim and its list. Whether the list is open is the shell's, handed in as props. */
export const PinnedIngredientsBar: FC<PinnedIngredientsBarProps> = ({ facts, open, onOpenChange, children }) => (
    // `hidden` from a 720 px body: the sticky card does this job there (R2), and the bar never draws.
    <div className="@min-[45rem]/detail:hidden">
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Trigger asChild>
                <button type="button" aria-label={facts.name} className={`${BAR_PLACE} z-40 ${BAR_FACE}`}>
                    <BarContent facts={facts} open={open} />
                </button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-30 bg-scrim" />
                <Dialog.Content
                    aria-label={facts.dialogName}
                    aria-describedby={undefined}
                    // Focus goes to the panel itself (the content's last child), not to the close button Radix would pick first.
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();

                        if (
                            event.target instanceof HTMLElement &&
                            event.target.lastElementChild instanceof HTMLElement
                        ) {
                            event.target.lastElementChild.focus();
                        }
                    }}
                    className={`${BAR_PLACE} z-40 flex flex-col gap-2 ${PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME}`}
                >
                    <Dialog.Close aria-label={facts.name} className={`w-full shrink-0 ${BAR_FACE}`}>
                        <BarContent facts={facts} open />
                    </Dialog.Close>
                    <div tabIndex={-1} className={PANEL_CLASS_NAME}>
                        {children}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </div>
);
