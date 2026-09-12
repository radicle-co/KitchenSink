'use client';

/**
 * @module @commise/ui/popover — the web `Popover`: a non-modal dialog anchored to its trigger. A presentational
 * design-system primitive: it holds only its own open state, and its content and actions come from the caller.
 *
 * Radix Popover owns the APG behaviour: the trigger carries `aria-haspopup="dialog"`, `aria-expanded` and
 * `aria-controls`; Escape and an outside press close the panel; and focus returns to the trigger on every close route.
 * The panel flips and shifts to stay on screen (`collisionPadding`), so at 320 px it never causes horizontal scroll.
 *
 * - The trigger is 44 × 44 px (spec §3, 2.5.8) and its glyph is `aria-hidden`: `triggerLabel` alone names it.
 * - ⛔ No transition classes: the panel appears and disappears without motion, so `prefers-reduced-motion` has
 *   nothing to suppress.
 * - `'use client'`: it holds its open state, and the feature leaf that renders it is reachable from App Router
 *   server pages through the feature package's index (caught by `next build`, not by typecheck).
 *
 * @pattern Adapter over `@radix-ui/react-popover`, with the trigger owned so its state cannot drift from the panel
 */
import * as RadixPopover from '@radix-ui/react-popover';
import { useId, useState, type FC } from 'react';

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
    triggerId,
}) => {
    const titleId = useId();
    const [open, setOpen] = useState(false);

    const close = (): void => {
        setOpen(false);
    };

    return (
        <RadixPopover.Root open={open} onOpenChange={setOpen}>
            <RadixPopover.Trigger
                id={triggerId}
                aria-label={triggerLabel}
                aria-busy={busy || undefined}
                aria-describedby={describedBy}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-charcoal transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam"
            >
                <span aria-hidden="true" className="inline-flex">
                    {busy ? <Spinner /> : triggerIcon}
                </span>
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    aria-labelledby={titleId}
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                    className="z-50 flex w-[min(20rem,calc(100vw-1rem))] items-start gap-2 rounded-2xl bg-card py-2 pl-4 pr-2 shadow-lg"
                >
                    <div className="min-w-0 flex-1 pt-2">
                        <h2 id={titleId} className="break-words text-body-sm font-semibold text-charcoal">
                            {title}
                        </h2>
                        <div className="mt-1 break-words pb-2 text-body-sm text-charcoal">
                            {typeof children === 'function' ? children(close) : children}
                        </div>
                    </div>
                    <RadixPopover.Close
                        aria-label={closeLabel}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam"
                    >
                        <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
                            <path
                                d="M5 5l10 10M15 5L5 15"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </RadixPopover.Close>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
};
