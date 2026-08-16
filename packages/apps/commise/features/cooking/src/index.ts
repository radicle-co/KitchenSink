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

// ── Voice control (US-006 / D-004) ───────────────────────────────────────────
// The TOGGLE and its model are platform-free (the leaf resolves per bundler, and neither file imports a
// recogniser), so both are safe to re-export. The ADAPTERS below are not.
export { VoiceControlToggle } from './VoiceControlToggle';
export { canToggleVoiceControl, formatStepAnnouncement } from './voiceControlModel';
export type { VoiceControlState, VoiceControlToggleProps } from './voiceControlModel';
export type { CookingVoiceControlPort, VoiceControlStatus } from './voiceControlPolicy';

// ── Platform adapters for the cooking-core ports (FR-035) ────────────────────
// The wake-lock adapter is exported so an app can inject a different one (a no-op in a test, say).
// `CookingModeScreen` already defaults to the right one for its platform.
export { acquireWebWakeLock } from './wakeLock';

// The VOICE adapters are deliberately NOT re-exported here, and this must stay true. Under Metro
// `./voiceControl` resolves to the `.native` leaf, which imports `expo-speech-recognition` at module
// scope — so exporting it from the barrel would drag an OS speech recogniser into the graph of every
// consumer, including ones that only want `StepDisplay`. `CookingModeScreen` imports its own platform
// adapter directly (`./voiceControl` on web, `./voiceControl.native` on mobile) and defaults the
// `voiceControl` prop to it, which is the ONE place that binding is made. A host wanting a different
// adapter passes it as that prop, or imports the leaf directly — it does not come through here.
