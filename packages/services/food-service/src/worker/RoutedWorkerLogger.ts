/**
 * `RoutedWorkerLogger` — the production {@link WorkerLogger}, routed through the shared rule.
 *
 * ⛔ IT WAS `ConsoleWorkerLogger`, AND THE RENAME IS THE POINT. That class promised "a JSON-line logger over
 * `console`", and after U22a step 2 that promise is false for one level: an `error` goes to this service's
 * own Sentry project instead, because under ADR-0042 the console line is ALREADY forwarded to the shared
 * `kitchensink-log-drain` project and writing both records one failure twice. Keeping the old name would
 * have cost nothing in churn and left a class whose docstring contradicted its behaviour.
 *
 * ⛔ THE PORT IS UNTOUCHED, WHICH IS THE PORT WORKING RATHER THAN BEING OVERRULED. `workerLogger.ts` says it
 * is "Kept as a tiny interface (not a Powertools/Sentry dependency) so the consumer is trivially testable";
 * that decision is about the INTERFACE, and it still holds literally — the port imports nothing,
 * `SilentWorkerLogger` is still the test default, and every consumer still takes a `WorkerLogger`. What
 * changed is which adapter the bootstrap wires, which is exactly the substitution a port exists to allow.
 *
 * ⛔ AND IT CLOSES A LEAK THE OLD ADAPTER HAD. `ConsoleWorkerLogger.emit` spread its `context` straight into
 * `JSON.stringify` with NO scrubbing, onto a stream ADR-0042's drain forwards off the host — and the
 * forwarder's own sanitiser covers five key names and URL path segments and nothing else. The sink scrubs
 * the console path (`scrubAttributes`) because nothing downstream of it does.
 */
import { emitLogRecord } from '@kitchensink/service-logging';

import type { LogContext, WorkerLogger } from './workerLogger.js';

export class RoutedWorkerLogger implements WorkerLogger {
    /** @param component - A static component tag added to every record. */
    public constructor(private readonly component: string = 'food-fetch-consumer') {}

    /** @inheritdoc @sideEffect Writes one JSON line to stdout. */
    public info(message: string, context?: LogContext): void {
        this.emit('info', message, context);
    }

    /** @inheritdoc @sideEffect Writes one JSON line to stdout. */
    public warn(message: string, context?: LogContext): void {
        this.emit('warn', message, context);
    }

    /** @inheritdoc @sideEffect Emits a Sentry log entry, or writes one JSON line to stderr. */
    public error(message: string, context?: LogContext): void {
        this.emit('error', message, context);
    }

    /**
     * Emit one record through the shared sink.
     *
     * ⚠️ `component` is carried as an ATTRIBUTE, where the old adapter wrote it as a top-level field of its
     * own JSON line. The key survives and so does every CloudWatch Insights query on it; what changes is
     * the field ORDER within the line, which nothing asserts and no query depends on.
     *
     * @param level - The log level.
     * @param message - The event name.
     * @param context - Structured fields.
     * @sideEffect Emits a log record.
     */
    private emit(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
        emitLogRecord(level, message, { component: this.component, ...context });
    }
}
