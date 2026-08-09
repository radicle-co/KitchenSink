import { matchVoiceCommand, type VoiceCommandListener, type VoiceControlDisposer } from '@kitchensink/cooking-core';

/**
 * The platform-free **session policy** shared by both Cooking Mode voice adapters (US-006,
 * FR-033/FR-034).
 *
 * The grammar lives in `@kitchensink/cooking-core`; the *recogniser* is platform-owned. What sits
 * between them — configure, attach, restart, latch, dispose — is neither, and it is the part that is
 * easy to get subtly wrong. It lives here ONCE because both platforms speak the same API surface:
 * `expo-speech-recognition` ships `ExpoWebSpeechRecognition`, a Web-Speech-*compatible* class with the
 * same `start`/`stop`, the same `result`/`error`/`end` events and the same `resultIndex` semantics as
 * the browser's `SpeechRecognition`. Two copies of this policy would drift, and a fix on one platform
 * would silently miss the other — exactly the failure mode the wake-lock port avoids.
 *
 * A platform adapter therefore supplies only what is genuinely platform-specific:
 *
 * - a {@link SpeechRecognitionFactory} — how this platform obtains a recogniser (and `null` when it
 *   has none), and
 * - an optional {@link RecognitionPermissionGate} — whether this platform must ask before listening.
 *   The browser prompts on `start()` and needs no gate; the OS does not, and native must ask first.
 *
 * Four properties are deliberate and load-bearing:
 *
 * 1. **Nothing touches a platform global at module scope.** `@commise/web` server-renders, so a
 *    top-level `window.` reference would throw `ReferenceError: window is not defined` on import and
 *    take down the Cooking Mode route — not merely disable voice. The factory is therefore *called*,
 *    never evaluated eagerly.
 * 2. **Absence of a recogniser — or a refused permission — is not an error.** An unsupported browser,
 *    a denied microphone, or an unlinked native module silently gets no voice control; navigation
 *    carries on with tap and gesture, which are the primary controls on both platforms. US-006 is
 *    *Should Have*: it degrades, it never breaks.
 * 3. **The listeners are owned by the disposer.** The recogniser holds a live microphone, so a listener
 *    that outlived the session would keep restarting recognition — and keep the mic hot — after the
 *    cook has left Cooking Mode. The `disposed` latch additionally swallows the event the platform had
 *    already queued when the disposer ran.
 * 4. **Restarting is budgeted.** Both platforms end recognition on their own after a few seconds of
 *    silence, so the policy restarts it or voice dies mid-recipe; but restarting unconditionally turns
 *    a recogniser that *cannot* start (no microphone, revoked permission) into a hot loop. Hence both
 *    the fatal-error latch and {@link MAX_CONSECUTIVE_RESTARTS}.
 */

/**
 * How many times recognition is restarted without an intervening result before the policy gives up.
 *
 * Exported so the bound is asserted rather than assumed — and re-exported by both adapters, so the two
 * platforms provably share one budget. Any result — recognised or not — proves the recogniser is alive
 * and replenishes the budget, so this only caps a genuinely dead recogniser.
 */
export const MAX_CONSECUTIVE_RESTARTS = 5;

/** BCP-47 tag for the grammar in `@kitchensink/cooking-core`, which is English-only. */
const RECOGNITION_LANGUAGE = 'en-US';

/**
 * Recognition errors that no restart can fix: the user denied the microphone, the platform refused the
 * service, no capture device exists, or the session was aborted. Anything else (notably `no-speech`
 * and `network`) is transient and worth another attempt.
 */
const FATAL_RECOGNITION_ERRORS: readonly string[] = ['not-allowed', 'service-not-allowed', 'audio-capture', 'aborted'];

// ── Minimal structural types for the Web Speech API ──────────────────────────
// `lib.dom` types `SpeechRecognitionResult` and friends but NOT `SpeechRecognition` itself, so the
// pieces this policy actually uses are declared here rather than reached through a cast. Index
// signatures yield `| undefined` on purpose: an out-of-range read really is `undefined` at runtime.
// `ExpoWebSpeechRecognition` satisfies the same shape, which is what makes one policy possible.

/** One candidate transcription of an utterance. */
export interface SpeechRecognitionAlternativeLike {
    readonly transcript: string;
}

/** One utterance's alternatives, plus whether the engine considers it settled. */
export interface SpeechRecognitionResultLike {
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

/** Every result the recogniser has produced this session, including ones already delivered. */
export interface SpeechRecognitionResultListLike {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

/** The `result` event both platforms dispatch. */
export interface SpeechRecognitionResultEventLike {
    /** Index of the first result added by this event; earlier entries were already delivered. */
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultListLike;
}

/** The `error` event both platforms dispatch. */
export interface SpeechRecognitionErrorEventLike {
    readonly error: string;
}

/** The subset of the Web Speech API the policy drives. Satisfied by the browser and by Expo alike. */
export interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    addEventListener(type: 'result', listener: (event: SpeechRecognitionResultEventLike) => void): void;
    addEventListener(type: 'error', listener: (event: SpeechRecognitionErrorEventLike) => void): void;
    addEventListener(type: 'end', listener: () => void): void;
    removeEventListener(type: 'result', listener: (event: SpeechRecognitionResultEventLike) => void): void;
    removeEventListener(type: 'error', listener: (event: SpeechRecognitionErrorEventLike) => void): void;
    removeEventListener(type: 'end', listener: () => void): void;
}

/**
 * Produces this platform's recogniser, or `null` when the platform has none.
 *
 * Called at session start, never at module scope, so an SSR import cannot touch a browser global.
 */
export type SpeechRecognitionFactory = () => SpeechRecognitionLike | null;

/**
 * Asks the platform for permission to listen.
 *
 * Resolves `true` only when listening is permitted. A rejection is treated exactly as a denial: the
 * session simply never starts, and it is never retried.
 */
export type RecognitionPermissionGate = () => Promise<boolean>;

/** Everything a platform adapter contributes to a voice session. */
export interface VoiceControlPolicy {
    /** How this platform obtains a recogniser. */
    readonly createRecognition: SpeechRecognitionFactory;
    /**
     * How this platform asks to listen, when it must. Omit where the platform prompts on `start()`
     * itself (the browser does); supply it where the OS requires an explicit request (Expo does).
     */
    readonly requestPermission?: RecognitionPermissionGate;
}

/**
 * Runs one voice-control session under the shared policy.
 *
 * The return is synchronous even when {@link VoiceControlPolicy.requestPermission} is supplied: the
 * `VoiceControlPort` contract is synchronous so the calling hook can dispose in a `useEffect` cleanup
 * without racing an unresolved promise. A pending permission request that resolves *after* disposal
 * finds `disposed` already set and starts nothing.
 *
 * @param policy - The platform's recogniser factory and optional permission gate.
 * @param onCommand - Invoked once per recognised command, never for an unrecognised utterance.
 * @returns A disposer that stops recognition and detaches every listener. Safe to call more than once.
 * @sideEffect Opens the microphone through the platform recogniser and holds listeners for the
 * session's lifetime. Never throws: an absent recogniser, a refused permission, and a rejected
 * `start()` all degrade to a working no-op disposer.
 */
export function startVoiceControl(policy: VoiceControlPolicy, onCommand: VoiceCommandListener): VoiceControlDisposer {
    let disposed = false;
    let fatallyFailed = false;
    let consecutiveRestarts = 0;
    let recognition: SpeechRecognitionLike | null = null;

    /** Starts recognition, absorbing the `InvalidStateError` a double start raises. */
    const startRecognition = (): void => {
        try {
            recognition?.start();
        } catch {
            // Losing voice control must never break Cooking Mode: the cook keeps the tap controls.
        }
    };

    const onResult = (event: SpeechRecognitionResultEventLike): void => {
        // `disposed` guards the event the platform had already queued when the disposer ran; without it
        // a command could still land after the cook left the session.
        if (disposed) {
            return;
        }

        // Any result at all proves the recogniser is alive, so the restart budget is replenished.
        consecutiveRestarts = 0;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];

            if (result === undefined || !result.isFinal) {
                continue;
            }

            const alternative = result[0];

            if (alternative === undefined) {
                continue;
            }

            const command = matchVoiceCommand(alternative.transcript);

            if (command !== null) {
                onCommand(command);
            }
        }
    };

    const onError = (event: SpeechRecognitionErrorEventLike): void => {
        if (FATAL_RECOGNITION_ERRORS.includes(event.error)) {
            fatallyFailed = true;
        }
    };

    const onEnd = (): void => {
        if (disposed || fatallyFailed || consecutiveRestarts >= MAX_CONSECUTIVE_RESTARTS) {
            return;
        }

        consecutiveRestarts += 1;
        startRecognition();
    };

    /** Constructs, configures and starts the recogniser. Idempotent by construction: called once. */
    const beginSession = (): void => {
        // Checked BEFORE construction, not after: an async permission gate can resolve long after the
        // cook left Cooking Mode, and constructing a recogniser is itself a platform side effect (on
        // iOS it configures an audio session). Nothing may be built for a session that is already over.
        if (disposed) {
            return;
        }

        let created: SpeechRecognitionLike | null;

        try {
            created = policy.createRecognition();
        } catch {
            // A platform whose recogniser cannot even be constructed (an unlinked native module) has no
            // voice control, which is a degradation, not a failure.
            created = null;
        }

        if (created === null) {
            return;
        }

        recognition = created;
        recognition.continuous = true;
        // Interim results re-deliver the same utterance as the engine refines it, which would fire a
        // command several times for one phrase.
        recognition.interimResults = false;
        recognition.lang = RECOGNITION_LANGUAGE;

        recognition.addEventListener('result', onResult);
        recognition.addEventListener('error', onError);
        recognition.addEventListener('end', onEnd);
        startRecognition();
    };

    const permissionGate = policy.requestPermission;

    if (permissionGate === undefined) {
        beginSession();
    } else {
        // Deliberately not awaited (the port is synchronous) and deliberately never retried: a denial is
        // a settled answer, and re-asking in a loop would spam the OS dialog mid-recipe.
        void Promise.resolve()
            .then(permissionGate)
            .then(
                (granted) => {
                    if (granted) {
                        beginSession();
                    }
                },
                () => {
                    // A permission request that fails outright is treated exactly as a denial.
                },
            );
    }

    return (): void => {
        if (disposed) {
            return;
        }

        disposed = true;

        if (recognition === null) {
            // Either the platform had no recogniser, or permission is still pending — in which case the
            // latch above stops the session from ever starting.
            return;
        }

        recognition.removeEventListener('result', onResult);
        recognition.removeEventListener('error', onError);
        recognition.removeEventListener('end', onEnd);

        try {
            recognition.stop();
        } catch {
            // Stopping a recogniser that never started throws on some platforms; the session is over
            // either way, and that must not propagate into the caller's unmount path.
        }
    };
}
