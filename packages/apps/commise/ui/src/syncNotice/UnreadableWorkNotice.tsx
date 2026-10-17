'use client';

/**
 * @module @commise/ui/sync-notice — the web unreadable-work notice (`docs/design/uiOverhaul/specSharedSystem.md` §17).
 *
 * It tells the cook, once, that work on this device was set aside because it could not be read (ADR-0057), and that it
 * cannot be recovered. Unlike `SyncNotice` it is DISMISSIBLE: this is a past event, and a card with no way out would
 * stay forever.
 *
 * ⛔ POLITE, NOT ASSERTIVE. The cook did not just act and nothing needs a decision, so the region is a `status`, mounted
 * EMPTY so the card's arrival is spoken (a region inserted with its text is not reliably read out).
 *
 * ⛔ AFTER DISMISS, FOCUS GOES TO THE REGION, which stays mounted and takes `tabIndex={-1}`: the pressed button is gone,
 * and focus would otherwise fall to `<body>` (WCAG 2.2 SC 2.4.3). `useFocusOnSignal` moves it only if focus was lost, so
 * a cook who has already moved on keeps their place. It is never moved when the card merely arrives.
 *
 * A presentational leaf apart from that one focus move: the caller owns whether the card shows.
 *
 * @pattern Adapter over the ARIA live-region protocol — a polite `status` announcement with one Dismiss control, plus
 *     `useFocusOnSignal` for the focus hand-off
 */
import { useState, type FC } from 'react';

import { Button } from '../button/Button.js';
import { useFocusOnSignal } from '../dialogFocus/useFocusOnSignal.js';
import { Icon } from '../icon/Icon.js';
import type { UnreadableWorkNoticeProps } from './props.js';

/** The notice: a silent status region until work was set aside, then the card with its Dismiss. */
export const UnreadableWorkNotice: FC<UnreadableWorkNoticeProps> = ({
    shown,
    title,
    body,
    dismissLabel,
    onDismiss,
}) => {
    // Counts the dismissals: the signal that moves focus. Advanced by the press, never by the card arriving or leaving.
    const [dismissals, setDismissals] = useState(0);
    const region = useFocusOnSignal<HTMLDivElement>(dismissals);

    return (
        <div ref={region} role="status" tabIndex={-1} className="px-4 outline-none">
            {shown && (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl bg-attention-tint px-4 py-3">
                    <span className="pt-0.5 text-attention">
                        <Icon name="triangleAlert" size={20} tone="attention" />
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                        <p className="text-body-sm font-semibold text-ink">{title}</p>
                        <p className="text-body-sm text-ink">{body}</p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => {
                            setDismissals((count) => count + 1);
                            onDismiss();
                        }}
                    >
                        {dismissLabel}
                    </Button>
                </div>
            )}
        </div>
    );
};
