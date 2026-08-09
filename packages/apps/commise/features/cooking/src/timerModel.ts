/**
 * @module @commise/features-cooking/timerModel — the platform-neutral contract + pure presentation logic
 * behind Cooking Mode's three timer render components (FR-034).
 *
 * Pattern: **Humble Object**. Every decision the timer surfaces make that is worth proving — is there a
 * badge at all, how does a millisecond count read as a clock — lives here as a pure function over plain
 * data, so it is provable without a renderer and CANNOT drift between the web `.tsx` and native
 * `.native.tsx` leaves. The leaves are the humble half: `props → JSX`, no fetching, no mutation, no
 * timers of their own. The live countdown is computed upstream by the session orchestrator (the timer
 * engine in `@kitchensink/cooking-core`) and arrives here as an already-computed `remainingMs`.
 *
 * Two type rules are load-bearing:
 *  - **No recipe-shaped type is defined here** (GR-007 / spec D-003). Steps arrive as the shipped
 *    {@link RecipeStepView} — the READ projection the client actually holds (`RecipeDetail.steps`), which
 *    already carries `stepNumber`, `instruction` and the inline `timerSeconds`. The persistence-side
 *    `RecipeStep` is deliberately not used: its `id`/`recipeId` never reach a client.
 *  - **No timer type is redefined.** A running timer is the shipped {@link CookingTimer}, paired with its
 *    computed remainder by {@link ActiveTimerView}.
 *
 * There is deliberately NO scale factor anywhere in this contract: cook time does not scale with yield, so
 * scaling changes quantities only (FR-034a / spec D-002). A timer surface that could accept a scale factor
 * would make the unsafe behaviour representable.
 */
import type { CookingTimer } from '@kitchensink/cooking-core';
import type { RecipeStepView } from '@kitchensink/recipe-core';

/**
 * The timer duration a step declares, in milliseconds — or `undefined` when the step declares none and
 * therefore MUST render no badge at all (FR-034).
 *
 * `timerSeconds` is validated as a NON-NEGATIVE integer upstream, so `0` is representable on the wire; a
 * zero-length countdown is not a timer, so it collapses to "no badge" rather than rendering a `0:00`
 * control that would complete the instant it started. Non-finite input is treated the same way.
 *
 * The recipe's unit is SECONDS (see `CookingTimer.durationMs`) — reading it as minutes yields timers 60x
 * wrong, which is why the conversion exists exactly once, here.
 */
export function stepTimerDurationMs(step: RecipeStepView): number | undefined {
    const seconds = step.timerSeconds;

    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }

    return seconds * 1000;
}

/**
 * Render a millisecond remainder as a clock readout through the localized `{minutes}:{seconds}` template.
 *
 * Seconds are rounded UP, which is the correct countdown semantic: a timer reads `0:01` for the whole of
 * its final second and reaches `0:00` only when it is genuinely done (flooring would show `0:00` for a
 * full second while the timer still ran). Seconds are zero-padded to two digits so the readout does not
 * jitter in width; minutes are not padded, and are free to exceed two digits for a long braise.
 *
 * An overshoot (the engine reporting a negative remainder for an already-elapsed timer) and a non-finite
 * value both clamp to zero rather than rendering `-1:-1` or `NaN:NaN`.
 */
export function formatRemaining(remainingMs: number, template: string): string {
    const safeMs = Number.isFinite(remainingMs) ? remainingMs : 0;
    const totalSeconds = Math.max(0, Math.ceil(safeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return template.replace('{minutes}', String(minutes)).replace('{seconds}', String(seconds).padStart(2, '0'));
}

/**
 * One running timer as the list renders it: the shipped domain timer plus the remainder the orchestrator
 * computed for this frame. A view-model pairing, never a redefinition of {@link CookingTimer}.
 */
export interface ActiveTimerView {
    /** The session's timer record — the source of `id`, `label` and `isPaused`. */
    readonly timer: CookingTimer;
    /** Milliseconds left, computed upstream against the clock. Negative/overshot values render as `0:00`. */
    readonly remainingMs: number;
}

/** Contract for the per-step timer badge (FR-034): duration in, start intent out. */
export interface TimerBadgeProps {
    /** The step being displayed. A step with no (or a zero-length) `timerSeconds` renders no badge. */
    readonly step: RecipeStepView;
    /**
     * Raised when the cook starts this step's timer. The whole step is handed back so the orchestrator can
     * derive the {@link CookingTimer} (`stepNumber`, label, `durationMs`) without re-reading the recipe.
     */
    readonly onStart: (step: RecipeStepView) => void;
}

/** Contract for the concurrent-timer list (FR-034). Intent leaves as a timer id; no state lives here. */
export interface ActiveTimersProps {
    /** Every timer the session is currently running, paused ones included. Empty renders nothing. */
    readonly timers: readonly ActiveTimerView[];
    /** Raised with the id of the running timer to pause. */
    readonly onPause: (timerId: string) => void;
    /** Raised with the id of the paused timer to resume. */
    readonly onResume: (timerId: string) => void;
    /** Raised with the id of the timer to cancel outright. */
    readonly onCancel: (timerId: string) => void;
}

/** Contract for the completion alert (FR-034). */
export interface TimerAlertProps {
    /**
     * The timer that just finished, or `undefined` when nothing has — in which case NOTHING renders (no
     * empty live region that a screen reader could announce spuriously).
     *
     * The audible chime is NOT this component's job: it is a side effect, and this leaf is pure. The
     * orchestrator owns the engine, so it already knows the instant a timer completes — the same fact it
     * passes down here is the one it plays the chime from. There is deliberately no audio prop to ignore.
     */
    readonly completedTimer?: CookingTimer;
    /** Raised with the completed timer's id when the cook dismisses the alert. */
    readonly onDismiss: (timerId: string) => void;
}
