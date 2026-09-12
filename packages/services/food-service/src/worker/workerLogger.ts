/**
 * Minimal structured-logging seam for the fan-out worker (T-150). The worker emits one structured
 * record per lifecycle event (lock acquired, lease claimed, disposition, defer, failure, tombstone) so
 * the Fargate task's stdout is machine-parseable. Kept as a tiny interface (not a Powertools/Sentry
 * dependency) so the consumer is trivially testable; the bootstrap wires the concrete sink.
 *
 * This module is the PORT only. Its implementations are `ConsoleWorkerLogger` (production JSON lines)
 * and `SilentWorkerLogger` (the test default), each in its own file per §1.
 */

/** A structured log record's contextual fields. */
export type LogContext = Record<string, unknown>;

/** The structured logger the worker depends on. */
export interface WorkerLogger {
    /**
     * Log an informational lifecycle event.
     *
     * @param message - The event name.
     * @param context - Structured fields.
     */
    info(message: string, context?: LogContext): void;
    /**
     * Log a warning (recoverable degradation — e.g. a deferred lease or a swallowed event-bus put).
     *
     * @param message - The event name.
     * @param context - Structured fields.
     */
    warn(message: string, context?: LogContext): void;
    /**
     * Log an error (a real source/processing failure).
     *
     * @param message - The event name.
     * @param context - Structured fields.
     */
    error(message: string, context?: LogContext): void;
}
