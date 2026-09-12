/**
 * The once-per-session nudge latch — split out of `SubscriptionNudge.tsx` so each hook owns a file
 * (`oneHookPerFile`). Independent of the Home nudge context: this one holds its own state.
 */
import { useCallback, useState } from 'react';

/** The live nudge state owned by the Home surface: whether it is visible plus its trigger/dismiss controls. */
export interface OncePerSessionNudge {
    /** Whether the nudge is currently shown. */
    readonly visible: boolean;
    /** Show the nudge — a no-op once it has already been shown this session. */
    readonly trigger: () => void;
    /** Hide the nudge (does not re-arm it — it stays spent for the session). */
    readonly dismiss: () => void;
}

/**
 * The nudge's whole lifecycle, as ONE value.
 *
 * ⛔ Not a `visible` flag beside a separate "has fired" latch: that pair can spell two states this feature
 * does not have — spent-but-visible, and visible-but-not-spent — and keeping them in agreement was the only
 * thing stopping the nudge appearing twice. Reading the spent-ness out of a ref made it worse, because a ref
 * is not state React tracks: nothing re-renders on it, and it is exactly the render-affecting bookkeeping
 * CLAUDE.md §3 rules out. With one value the illegal states are unrepresentable.
 */
type NudgePhase =
    /** Never triggered. The next trigger shows it. */
    | 'armed'
    /** On screen. Further triggers are no-ops; a dismissal spends it. */
    | 'showing'
    /** Shown and dismissed. Spent for the session — no trigger re-arms it. */
    | 'spent';

/**
 * Own the once-per-session nudge state. The first {@link OncePerSessionNudge.trigger} shows it; every later
 * trigger is a no-op for the session, so it can appear at most once regardless of how many gated taps occur.
 * Dismissing hides it without re-arming.
 *
 * @returns The nudge visibility plus its trigger/dismiss controls.
 */
export function useOncePerSessionNudge(): OncePerSessionNudge {
    const [phase, setPhase] = useState<NudgePhase>('armed');

    // Functional updaters: two gated widgets tapping in the same batch must not both read `armed`.
    const trigger = useCallback(() => setPhase((current) => (current === 'armed' ? 'showing' : current)), []);
    const dismiss = useCallback(() => setPhase((current) => (current === 'showing' ? 'spent' : current)), []);

    return { visible: phase === 'showing', trigger, dismiss };
}

/** Props for `SubscriptionNudge`. */
