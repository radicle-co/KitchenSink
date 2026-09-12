/**
 * `ConsoleWorkerLogger` — the production {@link WorkerLogger}: a JSON-line logger over `console`.
 *
 * Each record is `{ level, component, message, timestamp, ...context }` on one line, so the Fargate task's
 * stdout is machine-parseable by CloudWatch without a log-shipping dependency.
 */
import type { LogContext, WorkerLogger } from './workerLogger.js';

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
