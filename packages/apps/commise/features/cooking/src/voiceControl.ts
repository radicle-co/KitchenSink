import type { VoiceCommandListener, VoiceControlDisposer, VoiceControlPort } from '@kitchensink/cooking-core';

import { startVoiceControl, type SpeechRecognitionLike } from './voiceControlPolicy';

/**
 * Web adapter for Cooking Mode voice control (US-006, FR-033/FR-034).
 *
 * Implements the `VoiceControlPort` contract from `@kitchensink/cooking-core` over the Web Speech API
 * (`window.SpeechRecognition`, still `webkitSpeechRecognition` in Chrome/Safari). Two things this file
 * deliberately does NOT own:
 *
 * - the **grammar**, which lives in the core package and is shared with mobile, and
 * - the **session policy** — configure, attach, restart, latch, dispose — which lives in
 *   {@link ./voiceControlPolicy} and is shared with `voiceControl.native.ts`. Both adapters bind the
 *   same {@link MAX_CONSECUTIVE_RESTARTS} budget and the same fatal-error latch, so the platforms
 *   cannot drift and a fix on one cannot silently miss the other.
 *
 * All that remains here is the one genuinely web-specific fact: *where the constructor lives*. The
 * browser prompts for the microphone on `start()`, so the web binding supplies **no** permission gate.
 *
 * Nothing touches a browser global at module scope. `@commise/web` server-renders, so a top-level
 * `window.` reference would throw `ReferenceError: window is not defined` on import and take down the
 * Cooking Mode route — not merely disable voice.
 */

export { MAX_CONSECUTIVE_RESTARTS } from './voiceControlPolicy';

/** Constructs the platform recogniser. Both names have shipped; both are absent where unsupported. */
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** The two names the constructor has shipped under; both are absent on an unsupported browser. */
type SpeechRecognitionCapableWindow = Window & {
    readonly SpeechRecognition?: SpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

/**
 * Finds the platform's speech-recognition constructor.
 *
 * @returns The constructor, or `null` when the page is server-rendered or the browser has no support.
 * @sideEffect Reads browser globals. Called only from within {@link startWebVoiceControl}.
 */
function resolveRecognitionConstructor(): SpeechRecognitionConstructor | null {
    // `typeof` rather than a truthiness check: under SSR the identifier is not merely falsy, it is
    // undeclared, and referencing it throws.
    if (typeof window === 'undefined') {
        return null;
    }

    const scope = window as SpeechRecognitionCapableWindow;

    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Creates a browser recogniser, or `null` when the browser has none.
 *
 * @returns A live `SpeechRecognition`, or `null`.
 * @sideEffect Reads browser globals and constructs a recogniser.
 */
function createWebRecognition(): SpeechRecognitionLike | null {
    const Recognition = resolveRecognitionConstructor();

    return Recognition === null ? null : new Recognition();
}

/**
 * Starts listening for Cooking Mode voice commands in the browser.
 *
 * @param onCommand - Invoked once per recognised command, never for an unrecognised utterance.
 * @returns A disposer that stops recognition and detaches every listener.
 * @sideEffect Opens the microphone via the Web Speech API and holds listeners for the session's
 * lifetime. Returns a working no-op disposer — it never throws — when recognition is unavailable.
 */
export const startWebVoiceControl: VoiceControlPort = (onCommand: VoiceCommandListener): VoiceControlDisposer =>
    // No permission gate: the browser prompts on `start()`, and a denial surfaces as the fatal
    // `not-allowed` error the shared policy already latches on.
    startVoiceControl({ createRecognition: createWebRecognition }, onCommand);
