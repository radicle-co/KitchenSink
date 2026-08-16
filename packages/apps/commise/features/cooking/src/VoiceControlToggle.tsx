'use client';

/**
 * @module @commise/features-cooking/VoiceControlToggle — the WEB voice-control toggle (US-006 / D-004).
 *
 * Pattern: a pure **presentational leaf** (`props → JSX`) over the {@link voiceControlModel} policy
 * module. It holds no session state, opens no microphone, fetches nothing and takes no ref — the state
 * arrives as a prop and the single intent leaves as a callback, exactly as plan.md §4 prescribes for the
 * children of `CookingModeScreen`.
 *
 * **This control IS the consent.** Cooking Mode never opens the microphone on arrival: a recogniser that
 * starts itself because a screen mounted is a privacy-hostile default, and the cook's press is the one
 * signal that says otherwise. Everything about this leaf follows from that — it is deliberately labelled
 * and stateful-looking rather than a discreet icon, so nobody can be listening without the surface
 * saying so.
 *
 * **Accessibility (NFR-003/NFR-004).** The accessible NAME states the control and its state together
 * ("Voice control Listening"), so name-based selection is exact and — per WCAG 2.5.3 — the visible words
 * are contained in the name rather than overridden by an `aria-label`. `aria-pressed` carries the on/off
 * fact to assistive tech, the glyph is `aria-hidden` and varies in SHAPE as well as tone, and the state
 * is always stated in WORDS: no state here is carried by colour alone.
 *
 * **The two unavailable states stay mounted.** A refused microphone and a platform with no recogniser are
 * both settled answers ({@link canToggleVoiceControl}), so the control is marked `aria-disabled`, is
 * wired to NO handler — a structural no-op, not a runtime `if` a later edit can drop — and an
 * explanation is announced beside it and linked with `aria-describedby`. Removing the control instead
 * would reflow the header under a cook's hands and leave "why did nothing happen?" unanswered.
 */
import { useMessages } from '@commise/i18n/react';
import { useId, type FC, type ReactElement } from 'react';

import { cookingMessages } from './messages';
import {
    canToggleVoiceControl,
    formatVoiceControlName,
    type VoiceControlState,
    type VoiceControlToggleProps,
} from './voiceControlModel';

/** The idle microphone: an outline, no sound. Decorative — the words own the accessible name. */
const MicGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/** The listening microphone: the same body, FILLED and flanked by waves — a shape change, not a hue. */
const MicListeningGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M2 8v6M22 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/** The silenced microphone: the outline struck through. Used for both unavailable states. */
const MicOffGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/**
 * One glyph per state. A total {@link Record}, so a new state fails to COMPILE here rather than silently
 * rendering the wrong picture.
 */
const STATE_GLYPH: Readonly<Record<VoiceControlState, ReactElement>> = {
    idle: <MicGlyph />,
    listening: <MicListeningGlyph />,
    denied: <MicOffGlyph />,
    unsupported: <MicOffGlyph />,
};

/**
 * The control surface: a 44px-floor pill matching the header's secondary affordances, with the pressed
 * and unavailable treatments driven by ARIA state so the visual and the semantics cannot disagree.
 */
const TOGGLE_SURFACE =
    'inline-flex min-h-11 items-center gap-2 rounded-full border border-mist bg-white px-4 py-2.5 ' +
    'text-body-md font-semibold text-charcoal aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ' +
    'aria-pressed:border-seafoam aria-pressed:bg-seafoam/15';

/** The opt-in voice-control toggle shown in Cooking Mode's header (US-006). */
export const VoiceControlToggle: FC<VoiceControlToggleProps> = ({ state, onToggle }) => {
    const messages = useMessages(cookingMessages);
    const hintId = useId();

    // Total records rather than a `switch`: adding a state to the union breaks the build here, which is
    // the only place that guarantee is worth having.
    const stateLabel: Readonly<Record<VoiceControlState, string>> = {
        idle: messages.voiceIdleLabel,
        listening: messages.voiceListeningLabel,
        denied: messages.voiceDeniedLabel,
        unsupported: messages.voiceUnavailableLabel,
    };
    const stateHint: Readonly<Record<VoiceControlState, string | null>> = {
        idle: null,
        listening: null,
        denied: messages.voiceDeniedHint,
        unsupported: messages.voiceUnavailableHint,
    };

    const operable = canToggleVoiceControl(state);
    const hint = stateHint[state];

    return (
        <div className="flex flex-col items-start gap-1">
            <button
                type="button"
                // Stated rather than computed from the two text nodes below — the two platforms' name
                // calculations disagreed on the separator. The visible words are contained in it, so
                // WCAG 2.5.3 (label in name) still holds.
                aria-label={formatVoiceControlName(
                    messages.voiceControlName,
                    messages.voiceControlLabel,
                    stateLabel[state],
                )}
                aria-pressed={state === 'listening'}
                aria-disabled={operable ? undefined : true}
                aria-describedby={hint === null ? undefined : hintId}
                // No handler when the answer is settled: the no-op is STRUCTURAL, not a runtime guard.
                onClick={operable ? onToggle : undefined}
                className={TOGGLE_SURFACE}
            >
                <span aria-hidden="true" className="inline-flex shrink-0 items-center">
                    {STATE_GLYPH[state]}
                </span>
                <span>{messages.voiceControlLabel}</span>
                {/* NFR-004 — the state is always in WORDS, never in the glyph or the tint alone. */}
                <span className="font-normal text-slate">{stateLabel[state]}</span>
            </button>
            {hint !== null && (
                <p id={hintId} role="status" className="max-w-xs text-body-sm text-slate">
                    {hint}
                </p>
            )}
        </div>
    );
};
