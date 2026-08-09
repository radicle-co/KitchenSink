/**
 * Inert test stub for `expo-speech-recognition`.
 *
 * Why it exists at all: `@commise/features-cooking`'s barrel exports the voice-control adapter, whose
 * `.native` leaf imports this module at TOP LEVEL — so importing anything from the package pulls it into the
 * graph, and the real module bridges to an OS recogniser (via `expo`) that has no jsdom runtime. Without the
 * alias the whole mobile cooking suite fails to load, for a reason that has nothing to do with what it tests.
 *
 * Deliberately INERT, not a recording double. Cooking Mode never starts voice control on its own (it is
 * behind an explicit consent opt-in that US-006 has yet to specify), so no mobile-app test drives it; the
 * adapter's real contract — permission gate, grammar fidelity, restart budget, disposal — is proven in
 * `@commise/features-cooking`'s own suite against its recording stub. Copying that stub here would be a
 * second representation of the same knowledge with no consumer. If a mobile test ever DOES need to drive
 * recognition, use the feature package's stub shape rather than growing this one ad hoc.
 */

/** Minimal stand-in for the module's Web-Speech-compatible recognition class. Never started by these tests. */
export class ExpoWebSpeechRecognition {
    /** Language tag the recogniser would use. */
    public lang = 'en-US';
    /** Whether the recogniser would keep listening across utterances. */
    public continuous = false;
    /** Whether the recogniser would emit partial transcripts. */
    public interimResults = false;

    /**
     * Registers a listener. Inert — no event is ever dispatched.
     *
     * @sideEffect None; the call is discarded.
     */
    public addEventListener(): void {}

    /**
     * Removes a listener. Inert.
     *
     * @sideEffect None.
     */
    public removeEventListener(): void {}

    /**
     * Starts recognition. Inert.
     *
     * @sideEffect None.
     */
    public start(): void {}

    /**
     * Stops recognition. Inert.
     *
     * @sideEffect None.
     */
    public stop(): void {}

    /**
     * Aborts recognition. Inert.
     *
     * @sideEffect None.
     */
    public abort(): void {}
}

/** Minimal stand-in for the module's permission surface — always denied, so nothing can start by accident. */
export const ExpoSpeechRecognitionModule = {
    /**
     * Reports the OS microphone permission.
     *
     * @returns Always denied: a stub that granted permission could let a future regression start a
     * recogniser that has no runtime here, and fail somewhere far from the cause.
     */
    requestPermissionsAsync: async (): Promise<{ granted: boolean }> => ({ granted: false }),
};
