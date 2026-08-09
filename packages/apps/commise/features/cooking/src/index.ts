/**
 * `@commise/features-cooking` — the cross-platform Cooking Mode feature surface (feature 008).
 *
 * One orchestrational component (`CookingModeScreen`) plus its headless hook; everything else exported
 * here is a pure `props → JSX` leaf or a pure model. Domain logic lives in `@kitchensink/cooking-core`
 * and is not re-exported — consumers import it directly, so there is one authority for it.
 *
 * Platform leaves are selected by the bundler: `./CookingModeScreen` resolves to the `.native.tsx`
 * sibling under Metro and to the `.tsx` under the web build, so app code imports the same specifier on
 * both platforms.
 */

// ── Orchestration (T-006) ────────────────────────────────────────────────────
export { CookingModeScreen } from './CookingModeScreen';
export { TIMER_TICK_INTERVAL_MS, useCookingSession } from './useCookingSession';
export type {
    CookingModeScreenProps,
    CookingRecipeState,
    CookingSessionApi,
    CookingStepSurface,
    UseCookingSessionOptions,
} from './useCookingSession';

// ── Step surfaces (FR-032) ───────────────────────────────────────────────────
export { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from './StepDisplay';
export type { StepDisplayErrorProps, StepDisplayProps, StepPosition } from './stepDisplayModel';
export { formatStepPosition } from './stepPosition';

// ── Navigation (FR-033) ──────────────────────────────────────────────────────
export { StepNavigation } from './StepNavigation';
export type { StepNavigationProps } from './stepNavigationModel';

// ── Timers (FR-034) ──────────────────────────────────────────────────────────
export { ActiveTimers } from './ActiveTimers';
export { TimerAlert } from './TimerAlert';
export { TimerBadge } from './TimerBadge';
export type { ActiveTimersProps, ActiveTimerView, TimerAlertProps, TimerBadgeProps } from './timerModel';

// ── Ingredient checkoff (FR-032a) and yield scaling (FR-034a) ────────────────
export { IngredientChecklist } from './IngredientChecklist';
export { ScaleSelector } from './ScaleSelector';
export type { IngredientChecklistProps, ScaleSelectorProps, ScaledIngredientLine } from './sessionExtras';

// ── Platform adapters for the cooking-core ports (FR-035) ────────────────────
// The wake-lock adapter is exported so an app can inject a different one (a no-op in a test, say).
// `CookingModeScreen` already defaults to the right one for its platform.
export { acquireWebWakeLock } from './wakeLock';

// The VOICE adapters are deliberately NOT re-exported here. Under Metro `./voiceControl` resolves to
// the `.native` leaf, which imports `expo-speech-recognition` at module scope — so exporting it from
// the barrel would drag an OS speech recogniser into the graph of every consumer, including ones that
// only want `StepDisplay`. Nothing consumes them yet either: voice stays unwired until US-006
// specifies microphone consent. When it does, import the leaf directly
// (`@commise/features-cooking/src/voiceControl`) or give it its own package entry point, rather than
// making every consumer pay for it.
