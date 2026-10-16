/**
 * The fan-out worker's bootstrap failure handler: log the reason, then END the process.
 *
 * Setting `process.exitCode` is not enough here. `main.ts` keeps three pool sessions checked out for the process's
 * whole life, so a `start()` that rejects after taking the single-drainer advisory lock would leave a live task
 * holding that lock with no tick, no metrics and no check-in, and the worker container has no health check for
 * ECS to fail. Exiting closes the sessions, which frees the lock, and ECS starts a replacement.
 */

/** Where the handler writes and how it exits; injected so the order is testable without ending the test run. */
export interface BootstrapFailureDeps {
    readonly log: (line: string) => void;
    readonly exit: (code: number) => void;
}

/**
 * Log one structured line for a bootstrap failure, then exit with code 1.
 *
 * @param error - Whatever the bootstrap rejected with.
 * @param deps - The log sink and the exit; `console.error` and `process.exit` by default.
 * @sideEffect Writes to stderr and terminates the process.
 */
export function exitOnBootstrapFailure(
    error: unknown,
    deps: BootstrapFailureDeps = {
        log: (line) => {
            console.error(line);
        },
        exit: (code) => {
            process.exit(code);
        },
    },
): void {
    deps.log(JSON.stringify({ level: 'error', message: 'bootstrap-failed', error: String(error) }));
    deps.exit(1);
}
