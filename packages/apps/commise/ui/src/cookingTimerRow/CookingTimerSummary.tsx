/**
 * @module @commise/ui/cooking-timer-row — the web {@link CookingTimerSummary}: the body of a cooking timer row. A timer
 * glyph, the time, an optional status word and what the timer is for. The glyph hides above 1.3x text so the time keeps
 * its room (`leadingGlyphWebStyle`); the time never wraps and the meta does.
 *
 * It is not a live region. Its accessible name is the caller's `accessibilityLabel`: the visible text is hidden from
 * assistive technology and a sibling `sr-only` span carries the name, so the time is not read as digits.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Slot — a part that fills the row frame's `body` slot
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { leadingGlyphWebStyle } from '../text/scaledType.js';
import type { CookingTimerSummaryProps } from './props.js';

/** The cooking timer summary part. */
export const CookingTimerSummary: FC<CookingTimerSummaryProps> = ({ figure, status, meta, accessibilityLabel }) => (
    <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden="true" className="flex shrink-0 items-center text-ink" style={leadingGlyphWebStyle()}>
            <Icon name="timer" size={24} growsWithText />
        </span>
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
            <span className="text-figure-large shrink-0 whitespace-nowrap tabular-nums lining-nums text-ink">
                {figure}
            </span>
            {status === undefined ? null : <span className="text-label text-ink-muted">{status}</span>}
            <span className="text-meta min-w-0 text-ink-muted">{meta}</span>
        </div>
        <span className="sr-only">{accessibilityLabel}</span>
    </div>
);
