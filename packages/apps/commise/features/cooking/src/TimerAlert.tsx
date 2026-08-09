/**
 * @module @commise/features-cooking/TimerAlert — the web timer-completion banner (FR-034).
 *
 * Pattern: **pure presentational leaf** (`props → JSX`). It renders a banner for the timer that just
 * finished and raises the DISMISS intent; it plays no sound, sets no timeout and holds no state.
 *
 * The audible chime is deliberately NOT here. Playing audio is a side effect, and a side effect in a
 * render component is exactly what the design rules forbid; the orchestrator owns the timer engine, so it
 * already holds the fact this component is handed (`completedTimer`) at the moment it becomes true, and
 * plays the chime from there. There is no audio prop for a pure component to ignore.
 *
 * Accessibility is the point of this component, not a finish: a cook's hands are busy and the room is
 * loud, so the completion must be perceivable three ways — an ASSERTIVE, atomic live region that
 * interrupts a screen reader rather than queueing behind it, a NON-colour visual (glyph + text, per
 * NFR-004), and the orchestrator's chime. `role="alert"` already implies an assertive live region; the
 * explicit `aria-live` states the contract rather than relying on every AT's role mapping.
 *
 * When nothing has completed the component renders NOTHING — an always-mounted empty live region invites
 * spurious announcements on unrelated re-renders.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { cookingMessages } from './messages';
import type { TimerAlertProps } from './timerModel';

/** The decorative completion bell — a NON-colour pairing for the alert (NFR-004), hidden from AT. */
const BellGlyph: FC = () => (
    <svg aria-hidden="true" focusable="false" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none">
        <path
            d="M12 3a5 5 0 0 0-5 5v3l-1.5 3h13L17 11V8a5 5 0 0 0-5-5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
        />
        <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/** The completion banner for a finished timer, with an assertive announcement and a dismiss control. */
export const TimerAlert: FC<TimerAlertProps> = ({ completedTimer, onDismiss }) => {
    const messages = useMessages(cookingMessages);

    // Nothing finished: render nothing, so there is no idle live region to announce into.
    if (completedTimer === undefined) {
        return null;
    }

    const announcement = messages.timerCompleteAnnouncement.replace('{label}', completedTimer.label);

    return (
        <div className="flex w-full flex-wrap items-center gap-3 rounded-2xl border-2 border-warning bg-card p-4 shadow-sm">
            {/* The live region is scoped to the ANNOUNCEMENT alone — the dismiss control is a sibling, so
                the control's label is not read out as part of the interruption. */}
            <div
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="flex min-w-0 flex-1 items-center gap-3 text-body-lg font-semibold text-charcoal"
            >
                <BellGlyph />
                <span className="min-w-0">{announcement}</span>
            </div>
            <button
                type="button"
                onClick={() => onDismiss(completedTimer.id)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-pearl px-5 py-2.5 text-body-md font-semibold text-charcoal transition motion-reduce:transition-none hover:bg-mist/40"
            >
                {messages.dismissAlertLabel}
            </button>
        </div>
    );
};
