/**
 * `@kitchensink/cooking-core` — platform-free session and domain logic for Cooking Mode (feature 008).
 *
 * Contains no UI and no platform SDK. Recipe-shaped types come from `@kitchensink/recipe-core`
 * (GR-007). The wake lock is exposed as a **port**; its browser and Expo adapters live in
 * `@commise/features-cooking`, which is where a platform dependency is allowed to exist.
 */

// ── Types ────────────────────────────────────────────────────────────────────
export { ALLOWED_SCALE_FACTORS } from './types.js';
export type { CookingSession, CookingTimer, ScaleFactor } from './types.js';

// ── Shared errors ────────────────────────────────────────────────────────────
export {
    InvalidQuantityError,
    UnknownIngredientError,
    UnsupportedScaleFactorError,
    isInvalidQuantityError,
    isUnknownIngredientError,
    isUnsupportedScaleFactorError,
} from './errors.js';

// ── Ingredient checkoff (FR-032a) ────────────────────────────────────────────
export { isChecked, reconcile, toggleIngredient } from './controllers/IngredientCheckoffState.js';

// ── Yield scaling (FR-034a) ──────────────────────────────────────────────────
export { scaleQuantity, setScaleFactor, shouldShowNotScaledAdvisory } from './controllers/YieldScalingState.js';

// ── Session state machine (FR-032, FR-033) ───────────────────────────────────
export {
    InvalidStepIndexError,
    InvalidTotalStepsError,
    advance,
    createSession,
    goBack,
    goToStep,
    isInvalidStepIndexError,
    isInvalidTotalStepsError,
    pause,
    resume,
    sessionStatus,
} from './session.js';
export type { CreateSessionInput, SessionStatus } from './session.js';

// ── Timer engine (FR-034) ────────────────────────────────────────────────────
export {
    DuplicateTimerIdError,
    InvalidTimerDurationError,
    InvalidTimerStateError,
    InvalidTimestampError,
    StepHasNoTimerError,
    UnknownTimerError,
    cancelTimer,
    completedTimers,
    createTimerFromStep,
    isComplete,
    isDuplicateTimerIdError,
    isInvalidTimerDurationError,
    isInvalidTimerStateError,
    isInvalidTimestampError,
    isStepHasNoTimerError,
    isUnknownTimerError,
    pauseTimer,
    remainingMs,
    resumeTimer,
    startTimer,
    timerIdForStep,
} from './timerEngine.js';

// ── Voice control port + grammar (US-006, FR-033/FR-034) ─────────────────────
// Ships on BOTH platforms (owner ruling, 2026-08-09). The grammar and the port live here; the browser
// and Expo adapters live in `@commise/features-cooking`. `expo-speech-recognition` supplies a
// Web-Speech-COMPATIBLE recognition class, so both adapters bind the same shared policy rather than
// each re-deriving the restart/latch/dispose rules.
export {
    COOKING_VOICE_COMMANDS,
    InvalidVoiceGrammarError,
    VOICE_COMMAND_SYNONYMS,
    createVoiceCommandMatcher,
    isInvalidVoiceGrammarError,
    matchVoiceCommand,
    noopVoiceControl,
} from './voiceControl.js';
export type {
    CookingVoiceCommand,
    VoiceCommandListener,
    VoiceCommandMatcher,
    VoiceCommandSynonyms,
    VoiceControlDisposer,
    VoiceControlPort,
    VoiceGrammarDefect,
} from './voiceControl.js';

// ── Session persistence and the 24h resume window (FR-033) ───────────────────
export {
    CorruptSessionError,
    PERSISTED_SESSION_SCHEMA_VERSION,
    SESSION_RESUME_WINDOW_MS,
    clearSession,
    deserializeSession,
    isCorruptSessionError,
    persistSession,
    restoreSession,
    serializeSession,
} from './sessionPersistence.js';
export type { CookingSessionStore, SessionRestoreOutcome, SessionUnavailableReason } from './sessionPersistence.js';

// ── Wake lock port (FR-035) ──────────────────────────────────────────────────
export { createWakeLockController, noopWakeLock } from './wakeLockPort.js';
export type { WakeLockController, WakeLockDisposer, WakeLockPort } from './wakeLockPort.js';
