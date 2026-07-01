/**
 * Minimal structured-logging seam for the fan-out worker (T-150). The worker emits one structured
 * record per lifecycle event (lock acquired, lease claimed, disposition, defer, failure, tombstone) so
 * the Fargate task's stdout is machine-parseable. Kept as a tiny interface (not a Powertools/Sentry
 * dependency) so the consumer is trivially testable; the bootstrap wires the concrete sink.
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

/**
 * A JSON-line {@link WorkerLogger} over `console`. Each record is `{ level, message, ...context }` on
 * one line for CloudWatch ingestion.
 */
export class ConsoleWorkerLogger implements WorkerLogger {
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

    /** @inheritdoc @sideEffect Writes one JSON line to stderr. */
    public error(message: string, context?: LogContext): void {
        this.emit('error', message, context);
    }

    /**
     * Emit one structured JSON line.
     *
     * @param level - The log level.
     * @param message - The event name.
     * @param context - Structured fields.
     * @sideEffect Writes to `console`.
     */
    private emit(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
        const record = JSON.stringify({
            level,
            component: this.component,
            message,
            timestamp: new Date().toISOString(),
            ...context,
        });

        if (level === 'error') {
            console.error(record);
        } else {
            console.info(record);
        }
    }
}

/** A {@link WorkerLogger} that drops every record (test default). */
export class SilentWorkerLogger implements WorkerLogger {
    /** @inheritdoc */
    public info(): void {}
    /** @inheritdoc */
    public warn(): void {}
    /** @inheritdoc */
    public error(): void {}
}
