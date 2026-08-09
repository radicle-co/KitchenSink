/**
 * Session-scoped domain types for Cooking Mode (feature 008).
 *
 * This module deliberately defines **no recipe-shaped type**. Steps and ingredients come from the
 * shipped `@kitchensink/recipe-core` (`RecipeStep` already carries `stepNumber`, `instruction` and
 * the structured `timerSeconds`); defining a local copy is prohibited by governance rule GR-007
 * AC-007-d. See `specs/008-cooking-mode/spec.md` D-003.
 *
 * Every field here is JSON-round-trippable on purpose: the session is persisted to device storage
 * (AsyncStorage / IndexedDB) for offline resume, and `JSON.stringify(new Set())` is `{}` — a `Set`
 * would silently discard its contents on restore. See plan.md §2 "Serializability".
 */

/** Scale factors Cooking Mode offers for yield scaling (FR-034a). Bounded so illegal values are unrepresentable. */
export const ALLOWED_SCALE_FACTORS = [0.5, 1, 2, 3] as const;

/** A yield scale factor accepted by Cooking Mode. */
export type ScaleFactor = (typeof ALLOWED_SCALE_FACTORS)[number];

/**
 * A countdown timer belonging to one recipe step.
 *
 * `durationMs` is derived once, at construction, from `RecipeStep.timerSeconds`. The recipe's unit is
 * **seconds**; treating it as minutes yields timers 60x wrong.
 */
export interface CookingTimer {
    id: string;
    /** Human-readable label, e.g. "Marinate chicken". */
    label: string;
    /** The `RecipeStep.stepNumber` this timer belongs to. */
    stepNumber: number;
    /** Derived from `RecipeStep.timerSeconds * 1000`. Never scaled by the yield factor (FR-034a / D-002). */
    durationMs: number;
    /** ISO 8601 timestamp — never a `Date`, never epoch millis. */
    startedAt: string;
    isPaused: boolean;
    /** Remaining milliseconds captured at the moment the timer was paused. */
    pausedRemainingMs?: number;
    /**
     * ISO 8601 timestamp of when this timer's completion was announced to the user, if it has been.
     *
     * REQ-006 requires the completion alert to fire — once. Completion itself is *derived* from the
     * clock, so without a recorded acknowledgement the alert would re-fire on every render tick, and a
     * session restored from device storage would re-announce a timer that finished before the
     * interruption. Persisting the acknowledgement is what makes "once" survive a resume.
     */
    alertedAt?: string;
}

/**
 * The complete session-scoped state of one Cooking Mode session.
 *
 * None of this mutates the stored recipe — Cooking Mode is a read-only consumer (REQ-CN-001).
 */
export interface CookingSession {
    recipeId: string;
    /** ISO 8601 timestamp. */
    startedAt: string;
    currentStepIndex: number;
    /** Array, not a `Set`, so the session survives a JSON round-trip. */
    completedSteps: number[];
    /** Ingredient ids checked off during this session (FR-032a). Array for the same reason. */
    checkedIngredientIds: string[];
    /** Active yield scale factor (FR-034a). Display-only; defaults to 1. */
    scaleFactor: ScaleFactor;
    activeTimers: CookingTimer[];
    /** ISO 8601 timestamp set when the user exits mid-session. */
    pausedAt?: string;
}
