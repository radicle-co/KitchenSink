/**
 * @module @commise/features-cooking/TimerBadge — the web per-step timer badge (FR-034).
 *
 * Pattern: **pure presentational leaf** (`props → JSX`) over the Humble Object in `./timerModel`. It owns
 * no state, starts no interval, fetches nothing and holds no ref: it renders the duration the step
 * declares and one control that raises the START intent. The countdown itself belongs to the session
 * orchestrator, which is also the only thing that knows a timer exists after this badge is pressed.
 *
 * The "step has no timer" case is a STRUCTURAL gate, not a disabled control: a step without a duration
 * renders nothing at all, so there is no dead affordance for a cook to prod at (FR-034).
 *
 * The duration shown is the step's own `timerSeconds`, unscaled. Cook time does not scale with yield, so
 * the yield factor never reaches this component — it takes no scale prop and imports nothing that scales
 * (FR-034a / spec D-002).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { cookingMessages } from './messages';
import { formatRemaining, stepTimerDurationMs, type TimerBadgeProps } from './timerModel';

/**
 * A decorative clock glyph. `aria-hidden`, so the control's accessible name stays the localized label and
 * name-based selection (RTL / Playwright) is stable; it exists to pair the duration with a NON-colour
 * visual cue (NFR-004).
 */
const ClockGlyph: FC = () => (
    <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** The per-step timer badge — the step's duration plus the control that starts counting it down. */
export const TimerBadge: FC<TimerBadgeProps> = ({ step, onStart }) => {
    const messages = useMessages(cookingMessages);
    const durationMs = stepTimerDurationMs(step);

    // A step with no (or a zero-length) duration renders NO badge — the gate is structural (FR-034).
    if (durationMs === undefined) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-heading-md font-semibold tabular-nums text-charcoal shadow-sm">
                <ClockGlyph />
                {formatRemaining(durationMs, messages.timeRemaining)}
            </span>
            {/* `min-h-11` is NOT reset at `md:` the way the general-purpose controls are: Cooking Mode is a
                hands-busy surface on every viewport, so the comfortable 44px target holds on desktop too. */}
            <button
                type="button"
                onClick={() => onStart(step)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-seafoam px-5 py-2.5 text-body-md font-semibold text-white shadow-sm transition motion-reduce:transition-none hover:bg-ocean-dark"
            >
                {messages.startTimerLabel}
            </button>
        </div>
    );
};
