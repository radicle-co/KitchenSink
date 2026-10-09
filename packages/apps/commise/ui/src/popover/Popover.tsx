'use client';

/**
 * @module @commise/ui/popover — the web `Popover`: a non-modal dialog anchored to its trigger. A presentational
 * design-system primitive: it holds only its own open state, and its content and actions come from the caller.
 *
 * Radix Popover owns the APG behaviour: the trigger carries `aria-haspopup="dialog"`, `aria-expanded` and
 * `aria-controls`; Escape and an outside press close the panel. Escape and Close return focus to the trigger, and an
 * outside press leaves it where the cook put it (Radix's own rule, which `onDismissed` leaves in force).
 * The panel flips and shifts to stay on screen (`collisionPadding`), so at 320 px it never causes horizontal scroll, and
 * it keeps clear of the page's own chrome by reading the `PopupInsetsContext` reader as it opens (finding D2).
 *
 * - The trigger is 44 × 44 px (spec §3, 2.5.8) and its glyph is `aria-hidden`: `triggerLabel` alone names it.
 * - ⛔ No transition classes: the panel appears and disappears without motion, so `prefers-reduced-motion` has
 *   nothing to suppress.
 * - `'use client'`: it holds its open state, and the feature leaf that renders it is reachable from App Router
 *   server pages through the feature package's index (caught by `next build`, not by typecheck).
 * - A host's focus request (`focusRequested`) is the one reason this leaf holds a ref: `.focus()` has no declarative
 *   form. The request is a level the host clears on acknowledgement, so a trigger that mounts while it stands still
 *   takes it.
 *
 * @pattern Adapter over `@radix-ui/react-popover`, with the trigger owned so its state cannot drift from the panel
 * @pattern Adapter over the DOM focus API — a level-triggered focus request, acknowledged once taken
 */
import * as RadixPopover from '@radix-ui/react-popover';
import { useContext, useEffect, useEffectEvent, useId, useRef, useState, type FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { PopupInsetsContext, type PopupInsets } from '../popupInsets/popupInsetsContext.js';
import type { PopoverProps } from './props.js';

/**
 * The busy glyph, in the icon's own box: `currentColor`, and still under `prefers-reduced-motion` (it then shows as a
 * static ring, which still reads as "working" beside `aria-busy`).
 */
const Spinner: FC = () => (
    <svg className="h-5 w-5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

/** The popover: a named trigger and the panel it opens. */
export const Popover: FC<PopoverProps> = ({
    triggerLabel,
    triggerIcon,
    title,
    closeLabel,
    children,
    busy = false,
    describedBy,
    focusRequested = false,
    onFocusRequestHandled,
    onDismissed,
}) => {
    const titleId = useId();
    const [open, setOpen] = useState(false);
    // The page's chrome as it was when the panel opened, so it keeps clear of a bar along the foot (finding D2).
    const readInsets = useContext(PopupInsetsContext);
    const [insets, setInsets] = useState<PopupInsets>({ top: 0, bottom: 0 });
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

    const close = (): void => {
        setOpen(false);
    };

    return (
        <RadixPopover.Root
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    setInsets(readInsets());
                }

                setOpen(next);
            }}
        >
            <RadixPopover.Trigger
                ref={triggerNode}
                aria-label={triggerLabel}
                aria-busy={busy || undefined}
                aria-describedby={describedBy}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
                <span aria-hidden="true" className="inline-flex">
                    {busy ? <Spinner /> : <Icon name={triggerIcon} size={20} />}
                </span>
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    aria-labelledby={titleId}
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    collisionPadding={{ top: insets.top + 8, bottom: insets.bottom + 8, left: 8, right: 8 }}
                    // Radix makes its focus return after this handler; a host's request raised here is taken after
                    // render, so it lands last.
                    onCloseAutoFocus={() => {
                        onDismissed?.();
                    }}
                    className="z-50 flex w-[min(20rem,calc(100vw-1rem))] items-start gap-2 rounded-2xl bg-paper-overlay py-2 pl-4 pr-2 shadow-lg"
                >
                    <div className="min-w-0 flex-1 pt-2">
                        <h2 id={titleId} className="break-words text-body-sm font-semibold text-ink">
                            {title}
                        </h2>
                        <div className="mt-1 break-words pb-2 text-body-sm text-ink">
                            {typeof children === 'function' ? children(close) : children}
                        </div>
                    </div>
                    <RadixPopover.Close
                        aria-label={closeLabel}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <Icon name="x" size={20} />
                    </RadixPopover.Close>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
};
