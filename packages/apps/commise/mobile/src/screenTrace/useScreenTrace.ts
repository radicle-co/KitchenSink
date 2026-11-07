/**
 * Records that a screen is showing, for the Maestro screen recorder. THIS file is the Null Object every build ships:
 * it does nothing. A test build swaps it for `useScreenTrace.maestro.ts` at bundle time (`metro.config.cjs`, set by
 * the screen-trace build flag), which logs `COMMISE_SCREEN <name>`; the local lane runner collects those lines per flow and
 * `maestroFlowScreens.tsv` is checked against them.
 *
 * Both files MUST export the same signature; `tsc` holds them to it, because both are in the program.
 *
 * @pattern Null Object — build-time swap through a source extension, the mechanism `.native` already uses
 * @param _name - The screen's own name in `maestroFlowScreens.tsv` (its module name: `HomeScreen`, `login`).
 */
export function useScreenTrace(_name: string): void {
    // Nothing: a production bundle carries no recorder.
}
