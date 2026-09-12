'use client';

/**
 * @module home/SubscriptionNudge — the once-per-session subscription upgrade nudge (web).
 *
 * FR-046: a free-tier viewer who taps a premium-gated entry point on Home sees an upgrade nudge **at most
 * once per session**. The nudge is host-owned chrome; a widget triggers it through `useHomeNudge`
 * (the seam a future premium-gated widget calls). In Home v1 no live widget is premium-gated, so the
 * mechanism ships ready for the first gated widget (005–009) rather than firing on any current surface.
 *
 * "Once per session" is deliberately **component state**, not persisted — the requirement is per-session,
 * and a page reload legitimately starts a new session.
 *
 * @pattern Provider carrying the once-per-session nudge trigger down to widgets through the `useHomeNudge` seam, so a
 *     gated widget asks for the nudge without owning it.
 * @pattern Adapter over the house Radix `Dialog` for the nudge surface itself — Radix owns the focus trap,
 *     Escape-to-dismiss and background inert.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { type JSX } from 'react';

import { useMessages } from '@commise/i18n/react';
import { useReturnFocusOnClose } from '@commise/ui/dialog-focus';

import { webMessages } from '@/i18n/messages';

export interface SubscriptionNudgeProps {
    /** Whether the nudge is shown. */
    readonly open: boolean;
    /** Invoked when the viewer dismisses the nudge. */
    readonly onDismiss: () => void;
}

/**
 * The upgrade nudge dialog. Renders nothing when closed. Copy is localized via the web dictionary.
 *
 * The upgrade action currently dismisses (the subscription surface is owned by 010, not yet shipped); it is
 * wired as a distinct action so it becomes a real destination without a structural change when 010 lands.
 *
 * Built on Radix `Dialog` (B6/CR-003, mirrors `PullUpdatesDialog`'s pattern): Radix owns the focus trap,
 * Escape-to-dismiss, and background inert, so this component hand-rolls none of that (no `role="dialog"`
 * div). `onOpenChange` maps every Radix close path (Escape, backdrop) onto the same `onDismiss` the explicit
 * controls use — one exit path, not two.
 *
 * Focus-return is handled explicitly, NOT left to Radix's default: the gated widget's own control that calls
 * `useHomeNudge().trigger()` (wired in `HomeWidgetSurface`) is a SIBLING elsewhere in the tree, not an owned
 * `Dialog.Trigger`, so Radix's built-in `onCloseAutoFocus` (which only restores an OWNED trigger — see
 * `PullUpdatesDialog`'s module doc) would silently focus nothing. `useReturnFocusOnClose`
 * (`@commise/ui/dialog-focus`) owns the repair: it snapshots `document.activeElement` at the render where
 * `open` flips true — BEFORE `Dialog.Content` (and its own autofocus-on-mount) ever commits — and returns
 * the `onCloseAutoFocus` handler that restores it.
 */
export function SubscriptionNudge({ open, onDismiss }: SubscriptionNudgeProps): JSX.Element | null {
    const { home } = useMessages(webMessages);

    // Snapshot whatever had focus right before this dialog opened, and restore it on close — see the module
    // doc. The false→true edge guard lives inside the hook.
    const onCloseAutoFocus = useReturnFocusOnClose(open);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
                <Dialog.Content
                    aria-modal="true"
                    onCloseAutoFocus={onCloseAutoFocus}
                    // Bottom-pinned sheet: its foot must clear the device home indicator. The bottom padding is
                    // the sheet's `p-8` foot (2rem) PLUS the safe-area inset. `env(...)` is 0 in a normal
                    // viewport, so the base padding equals the foot and only real devices see the extra inset.
                    //
                    // `p-6` → `p-8` is a no-op in painted pixels: the DS used to redefine Tailwind's
                    // `--spacing-*` scale, under which `p-6` WAS 2rem. With the numeric utilities back on
                    // Tailwind's own ramp, 2rem is `p-8` — which is what keeps this foot equal to the literal
                    // `2rem` in the `calc()` beside it. Change one and you must change the other, or the sheet
                    // goes asymmetric. See `@commise/ui/tokens/themeCss`.
                    className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-t-2xl bg-white p-8 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-xl"
                >
                    <Dialog.Title className="font-display text-lg font-semibold text-charcoal">
                        {home.nudge.title}
                    </Dialog.Title>
                    <p className="text-sm text-slate">{home.nudge.body}</p>
                    <div className="flex justify-end gap-3">
                        <Dialog.Close type="button" className="rounded-full px-4 py-2 text-sm font-medium text-slate">
                            {home.nudge.dismiss}
                        </Dialog.Close>
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="rounded-full bg-seafoam px-5 py-2 text-sm font-semibold text-white"
                        >
                            {home.nudge.upgrade}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
