import { useEffect } from 'react';

/**
 * The test-build twin of `useScreenTrace.ts`: logs `COMMISE_SCREEN <name>` once per mount. Metro picks this file in place
 * of the Null Object only when the bundle is built with the screen-trace flag (see `metro.config.cjs`).
 *
 * `console.error`, not `log`: a Release build keeps only errors in the device log (logcat on Android, the unified log on
 * iOS), and a test build is a Release build.
 *
 * @pattern Null Object — the recording side of the swap
 * @sideEffect Writes one line to the device log when the screen mounts.
 * @param name - The screen's own name in `maestroFlowScreens.tsv`.
 */
export function useScreenTrace(name: string): void {
    useEffect(() => {
        console.error(`COMMISE_SCREEN ${name}`);
    }, [name]);
}
