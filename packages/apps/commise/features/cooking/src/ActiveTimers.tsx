/**
 * @module @commise/features-cooking/ActiveTimers — the web list of concurrently running timers (FR-034).
 *
 * Pattern: **pure presentational leaf** (`props → JSX`) over the Humble Object in `./timerModel`, plus a
 * **Command-shaped** intent surface: every control raises `onPause` / `onResume` / `onCancel` with the
 * timer's OWN id, so the orchestrator's reducer receives an addressed command rather than a positional
 * one. The list runs no interval and holds no state — `remainingMs` is computed upstream each frame.
 *
 * Two accessibility decisions are load-bearing:
 *  - Each countdown is a real ARIA `timer` (a live-region role meaning "time remaining until an end
 *    point"), NAMED by the step's label, so three concurrent timers are individually addressable by a
 *    screen reader and by name-based test/E2E selection.
 *  - Paused vs running is carried by the toggle's VISIBLE TEXT — "Pause timer" vs "Resume timer" — and a
 *    non-colour glyph and border treatment. Colour is never the sole conveyor (NFR-004), which matters
 *    doubly in a kitchen where the device is being glanced at from three feet away (SC-007).
 *
 * Nothing here scales with yield: cook time is not a function of servings (FR-034a / spec D-002).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { cookingMessages } from './messages';
import { formatRemaining, type ActiveTimersProps } from './timerModel';

/**
 * The decorative running/paused state glyph — a NON-colour pairing for the row's state (NFR-004), hidden
 * from assistive tech because the toggle's own text label already states the state in words.
 */
const StateGlyph: FC<{ paused: boolean }> = ({ paused }) => (
    <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none">
        {paused ? (
            <>
                <path d="M9 6v12M15 6v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </>
        ) : (
            <>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                    d="M12 7v5l3 2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </>
        )}
    </svg>
);

const CONTROL_CLASS =
    'inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-body-sm font-semibold transition motion-reduce:transition-none';

/** The list of timers the session is currently running — countdown, pause/resume and cancel, per timer. */
export const ActiveTimers: FC<ActiveTimersProps> = ({ timers, onPause, onResume, onCancel }) => {
    const messages = useMessages(cookingMessages);

    // No timers means no region at all — an empty labelled list would be chrome a screen reader has to
    // step through for nothing.
    if (timers.length === 0) {
        return null;
    }

    return (
        // `role="list"` is explicit: the list-style reset that Tailwind applies strips list semantics in
        // some browsers, and this region's whole job is to be enumerable.
        <ul role="list" aria-label={messages.activeTimersLabel} className="flex w-full flex-col gap-3">
            {timers.map(({ timer, remainingMs }) => (
                <li
                    key={timer.id}
                    className={`flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 shadow-sm ${
                        // A DASHED hairline + a dimmed surface, paired with the glyph and the "Resume
                        // timer" label — the paused state is legible without perceiving colour.
                        timer.isPaused ? 'border border-dashed border-slate opacity-80' : 'border border-border'
                    }`}
                >
                    <StateGlyph paused={timer.isPaused} />
                    <span className="min-w-0 flex-1 truncate text-body-md font-medium text-charcoal">
                        {timer.label}
                    </span>
                    <span
                        role="timer"
                        aria-label={timer.label}
                        className="text-heading-md font-semibold tabular-nums text-charcoal"
                    >
                        {formatRemaining(remainingMs, messages.timeRemaining)}
                    </span>
                    <span className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => (timer.isPaused ? onResume(timer.id) : onPause(timer.id))}
                            className={`${CONTROL_CLASS} bg-pearl text-charcoal hover:bg-mist/40`}
                        >
                            {timer.isPaused ? messages.resumeTimerLabel : messages.pauseTimerLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => onCancel(timer.id)}
                            className={`${CONTROL_CLASS} border border-error text-error-dark hover:bg-error/10`}
                        >
                            {messages.cancelTimerLabel}
                        </button>
                    </span>
                </li>
            ))}
        </ul>
    );
};
