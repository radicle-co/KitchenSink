/**
 * @module @commise/features-cooking/messages — user-facing copy for Cooking Mode (feature 008).
 *
 * Shared, platform-neutral strings live here as a {@link LocalizedMessages} dictionary, exported once
 * and consumed by BOTH the web `.tsx` and mobile `.native.tsx` leaves (via `useMessages`), so the
 * platforms cannot drift on copy. The `en` set is required; adding a locale is just another key.
 *
 * No component may hard-code a user-facing string — every one goes through this dictionary.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the Cooking Mode surface. */
export interface CookingMessages {
    /** Accessible name for the Cooking Mode region. */
    readonly modeLabel: string;
    /** Accessible name for the exit control. */
    readonly exitLabel: string;

    // ── Step display (FR-032) ────────────────────────────────────────────────
    /** Step position template; contains `{current}` and `{total}`. */
    readonly stepPosition: string;
    /** Accessible label for the step instruction text. */
    readonly instructionLabel: string;
    /**
     * Accessible name for a step's photo; contains `{current}`.
     *
     * Distinct from {@link stepPosition} on purpose — naming the image with the step position repeats
     * the heading beside it, which a screen reader then announces twice.
     */
    readonly stepImageLabel: string;
    /** Shown while the recipe is loading. */
    readonly loadingLabel: string;
    /** Heading shown when the recipe has no steps at all. */
    readonly emptyTitle: string;
    /** Body copy shown when the recipe has no steps at all. */
    readonly emptyBody: string;
    /** Body copy shown when the recipe could not be loaded. */
    readonly errorBody: string;
    /** Label of the retry action on the error state. */
    readonly retryLabel: string;

    // ── Navigation (FR-033) ──────────────────────────────────────────────────
    /** Accessible name for the previous-step control. */
    readonly previousLabel: string;
    /** Accessible name for the next-step control. */
    readonly nextLabel: string;
    /** Announced when the user is on the first step and cannot go back. */
    readonly atFirstStepLabel: string;
    /** Announced when the user is on the last step and cannot advance. */
    readonly atLastStepLabel: string;
    /** Label of the control that finishes the session on the last step. */
    readonly finishLabel: string;

    // ── Timers (FR-034) ──────────────────────────────────────────────────────
    /** Label of the control that starts a step's timer. */
    readonly startTimerLabel: string;
    /** Label of the control that pauses a running timer. */
    readonly pauseTimerLabel: string;
    /** Label of the control that resumes a paused timer. */
    readonly resumeTimerLabel: string;
    /** Label of the control that cancels a timer. */
    readonly cancelTimerLabel: string;
    /** Accessible name for the list of active timers. */
    readonly activeTimersLabel: string;
    /** Announced when a timer completes; contains `{label}`. */
    readonly timerCompleteAnnouncement: string;
    /** Label of the control that dismisses a completed-timer alert. */
    readonly dismissAlertLabel: string;
    /** Remaining-time template; contains `{minutes}` and `{seconds}`. */
    readonly timeRemaining: string;

    // ── Ingredient checkoff (FR-032a) ────────────────────────────────────────
    /** Label of the control that opens the ingredient list. */
    readonly ingredientsLabel: string;
    /** Accessible name for the ingredient list region. */
    readonly ingredientListLabel: string;
    /** Label of the control that dismisses the ingredient list. */
    readonly closeIngredientsLabel: string;
    /** Progress template for checked ingredients; contains `{checked}` and `{total}`. */
    readonly ingredientsChecked: string;
    /** Body copy shown when the recipe has no ingredients. */
    readonly ingredientsEmptyBody: string;

    // ── Voice control (US-006 / D-004) ───────────────────────────────────────
    /** Name of the voice-control toggle. Pairs with one state label below to form its accessible name. */
    readonly voiceControlLabel: string;
    /**
     * The toggle's accessible name; contains `{label}` and `{state}`.
     *
     * Composed EXPLICITLY rather than left to the accessible-name calculation over the two visible text
     * nodes: react-native-web renders them as its own `Text` elements and the computed name came out
     * unspaced ("Voice controlOff") where the web leaf's came out spaced — the same control announcing
     * two different names on the two platforms.
     */
    readonly voiceControlName: string;
    /** State word shown when voice control is off — the state Cooking Mode always opens in. */
    readonly voiceIdleLabel: string;
    /** State word shown while the microphone is open and listening for commands. */
    readonly voiceListeningLabel: string;
    /** State word shown when the platform refused the microphone. */
    readonly voiceDeniedLabel: string;
    /** State word shown when this platform has no speech recogniser at all. */
    readonly voiceUnavailableLabel: string;
    /** What the cook can do about a refused microphone. Announced with the disabled control. */
    readonly voiceDeniedHint: string;
    /** What the cook can do on a platform with no recogniser. Announced with the disabled control. */
    readonly voiceUnavailableHint: string;
    /**
     * The sentence the `repeat` voice command announces; contains `{position}` and `{instruction}`.
     *
     * Both a template and a joining rule: a locale whose sentence order or punctuation differs changes
     * this string rather than the components.
     */
    readonly voiceRepeatAnnouncement: string;

    // ── Yield scaling (FR-034a) ──────────────────────────────────────────────
    /** Accessible name for the yield scale control. */
    readonly scaleLabel: string;
    /** Scale-option template; contains `{factor}`. */
    readonly scaleOption: string;
    /**
     * The advisory shown whenever the scale factor is not 1x.
     *
     * Load-bearing safety copy: cook times do NOT scale with yield (spec.md D-002), so the user must
     * be told that only quantities changed.
     */
    readonly scaleNotAppliedToTimes: string;
}

/** Cooking Mode copy, keyed by locale. `en` is the required baseline. */
export const cookingMessages: LocalizedMessages<CookingMessages> = {
    en: {
        modeLabel: 'Cooking mode',
        exitLabel: 'Exit cooking mode',

        stepPosition: 'Step {current} of {total}',
        instructionLabel: 'Current step instruction',
        stepImageLabel: 'Photo for step {current}',
        loadingLabel: 'Loading recipe',
        emptyTitle: 'This recipe has no steps yet',
        emptyBody: 'Add instructions to the recipe to cook along with it.',
        errorBody: "We couldn't load this recipe.",
        retryLabel: 'Try again',

        previousLabel: 'Previous step',
        nextLabel: 'Next step',
        atFirstStepLabel: 'You are on the first step',
        atLastStepLabel: 'You are on the last step',
        finishLabel: 'Finish cooking',

        startTimerLabel: 'Start timer',
        pauseTimerLabel: 'Pause timer',
        resumeTimerLabel: 'Resume timer',
        cancelTimerLabel: 'Cancel timer',
        activeTimersLabel: 'Active timers',
        timerCompleteAnnouncement: '{label} timer finished',
        dismissAlertLabel: 'Dismiss',
        timeRemaining: '{minutes}:{seconds}',

        ingredientsLabel: 'Ingredients',
        ingredientListLabel: 'Ingredient checklist',
        closeIngredientsLabel: 'Close ingredients',
        ingredientsChecked: '{checked} of {total} checked',
        ingredientsEmptyBody: 'This recipe has no ingredients listed.',

        voiceControlLabel: 'Voice control',
        voiceControlName: '{label} {state}',
        voiceIdleLabel: 'Off',
        voiceListeningLabel: 'Listening',
        voiceDeniedLabel: 'Microphone blocked',
        voiceUnavailableLabel: 'Not available',
        voiceDeniedHint: 'Cooking mode cannot hear you until microphone access is allowed in your device settings.',
        voiceUnavailableHint: 'This device cannot listen for voice commands. Use the on-screen controls.',
        voiceRepeatAnnouncement: '{position}. {instruction}',

        scaleLabel: 'Servings',
        scaleOption: '{factor}x',
        scaleNotAppliedToTimes: 'Quantities are scaled. Cook times are not — check for doneness as you go.',
    },
};
