import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from 'expo-speech-recognition';

import type { VoiceCommandListener, VoiceControlDisposer } from '@kitchensink/cooking-core';

import {
    startVoiceControl,
    type CookingVoiceControlPort,
    type SpeechRecognitionLike,
    type VoiceControlStatusListener,
} from './voiceControlPolicy';

/**
 * Native (Expo) adapter for Cooking Mode voice control (US-006, FR-033/FR-034).
 *
 * Implements the same `VoiceControlPort` contract as the web adapter in `voiceControl.ts`, over
 * `expo-speech-recognition`'s `ExpoWebSpeechRecognition` — a Web-Speech-*compatible* class with the
 * same `start`/`stop`, the same `result`/`error`/`end` events and the same `resultIndex` semantics as
 * the browser's `SpeechRecognition`. That compatibility is what lets both platforms share ONE session
 * policy ({@link ./voiceControlPolicy}); this file contributes only the two platform facts:
 *
 * 1. **the recogniser** — `new ExpoWebSpeechRecognition()` rather than a browser global, and
 * 2. **the permission gate** — the OS does not prompt on `start()` the way a browser does, so the
 *    microphone (and, on iOS, the speech recogniser) must be requested explicitly first.
 *
 * Three details are load-bearing:
 *
 * - **The file must be named `.native.ts`.** Metro resolves the `.native` leaf in preference to the web
 *   sibling; a name it does not recognise (`-rn`, `-native`) would leave mobile silently running the
 *   web implementation, which reads `window.SpeechRecognition` and would simply never listen.
 * - **A denied permission is a normal outcome, not an error.** The adapter resolves to a working no-op
 *   disposer, starts nothing, throws nothing, and never re-asks. US-006 is *Should Have*: voice
 *   degrades while tap and gesture navigation — the primary controls on both platforms — carry on.
 *   Re-asking in a loop would also spam the OS dialog in the middle of a recipe.
 * - **The permission request is not awaited by the caller.** `VoiceControlPort` is synchronous so the
 *   calling hook can dispose in a `useEffect` cleanup without racing a promise; the shared policy
 *   latches disposal, so a grant that lands *after* the cook left Cooking Mode starts nothing.
 *
 * ⚠️ **UNVERIFIED ON DEVICE — SDK-generation risk.** `expo-speech-recognition`'s newest published
 * version is **56.0.1** and it publishes no `sdk-57` dist-tag, while this app runs **Expo 57 /
 * React Native 0.86**. The library is therefore one SDK generation behind its host, and Expo modules
 * can break across a generation (native build config, `expo-modules-core` ABI, autolinking). The
 * jsdom stub tests in `__tests__/voiceControl.native.test.tsx` prove **this adapter's contract** — that
 * it gates on permission, matches only declared phrases, disposes cleanly and cannot spin — and prove
 * nothing whatsoever about the native module linking, building, or capturing audio on a real device.
 * Native voice control must be confirmed on a physical iOS and Android build (a Maestro flow cannot
 * assert it either — the simulator has no microphone) before US-006 is claimed done on mobile.
 */

export { MAX_CONSECUTIVE_RESTARTS } from './voiceControlPolicy';

/**
 * Creates the Expo recogniser.
 *
 * @returns A live recogniser.
 * @sideEffect Constructs a native-backed recogniser. A construction failure (an unlinked native
 * module, e.g. under Expo Go) is caught by the shared policy and degrades to no voice control.
 */
function createNativeRecognition(): SpeechRecognitionLike {
    return new ExpoWebSpeechRecognition();
}

/**
 * Asks the OS for microphone and speech-recognition access.
 *
 * @returns `true` only when the cook granted access; `false` for every denial, including a permanent
 * one the app can no longer re-ask for.
 * @sideEffect Presents the OS permission dialog the first time; afterwards returns the stored decision.
 */
async function requestNativeRecognitionPermission(): Promise<boolean> {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    return permission.granted;
}

/**
 * Starts listening for Cooking Mode voice commands on device.
 *
 * @param onCommand - Invoked once per recognised command, never for an unrecognised utterance.
 * @param onStatus - Optional. Told when the session starts listening, and when it cannot — which is how
 * a refused microphone reaches the surface instead of vanishing into a silent degradation.
 * @returns A disposer that stops recognition and detaches every listener. Working even when permission
 * was denied or the request never resolved.
 * @sideEffect Requests OS microphone permission, then opens the microphone and holds listeners for the
 * session's lifetime. Never throws: a denial, a rejected request, and an unavailable native module all
 * degrade to a working no-op disposer.
 */
export const startNativeVoiceControl: CookingVoiceControlPort = (
    onCommand: VoiceCommandListener,
    onStatus?: VoiceControlStatusListener,
): VoiceControlDisposer =>
    startVoiceControl(
        { createRecognition: createNativeRecognition, requestPermission: requestNativeRecognitionPermission },
        onCommand,
        onStatus,
    );
