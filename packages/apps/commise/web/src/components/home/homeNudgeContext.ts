/**
 * The Home nudge CONTEXT and its reader, kept together because the reader is the only correct way to touch it.
 *
 * ⛔ Split out of `SubscriptionNudge.tsx`, which declared two hooks beside the component and so broke
 * `oneHookPerFile`. The context and `useHomeNudge` stay in ONE module deliberately: separating them would
 * leave callers free to `useContext(HomeNudgeContext)` directly and skip the null check that turns a missing
 * provider into a stated error instead of a silent no-op.
 */
import { createContext, useContext } from 'react';

/** The nudge trigger seam exposed to widgets via {@link HomeNudgeContext}. */
export interface HomeNudge {
    /** Request the upgrade nudge. A no-op after the nudge has already been shown once this session. */
    readonly trigger: () => void;
}

/** Context carrying the {@link HomeNudge} trigger down to widgets (provided by the Home surface). */
export const HomeNudgeContext = createContext<HomeNudge | null>(null);

/**
 * Read the Home nudge trigger. A premium-gated widget calls `useHomeNudge().trigger()` when a free-tier
 * viewer taps its gated entry point.
 *
 * @throws {Error} when used outside the Home widget surface (no provider).
 */
export function useHomeNudge(): HomeNudge {
    const nudge = useContext(HomeNudgeContext);

    if (nudge === null) {
        throw new Error('useHomeNudge must be used within the Home widget surface.');
    }

    return nudge;
}

/** The live nudge state owned by the Home surface: whether it is visible plus its trigger/dismiss controls. */
