import type { LoggerService } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Sentry-backed logging for the identity service (R14): purposeful logs go to the per-service
 * project via `Sentry.logger`, and nothing is written to stdout. Two surfaces:
 *
 * - `createServiceLogger` replaces per-class `new Logger(Name)` instances in application code,
 *   keeping the `.log/.warn/.error(message, extra?)` shape so call sites barely change.
 * - `NestSentryLogger` is the framework `LoggerService` passed to `NestFactory.create`, so Nest's
 *   own bootstrap/route output flows to Sentry instead of stdout (AE2 — avoids drain double-count).
 */

type LogExtra = Record<string, unknown> | string | undefined;

const toAttributes = (context: string, extra: LogExtra): Record<string, unknown> => {
    if (extra === undefined) {
        return { context };
    }

    if (typeof extra === 'string') {
        return { context, detail: extra };
    }

    return { context, ...extra };
};

export interface ServiceLogger {
    log: (message: string, extra?: LogExtra) => void;
    warn: (message: string, extra?: LogExtra) => void;
    error: (message: string, extra?: LogExtra) => void;
}

/** @sideEffect emits log entries to Sentry. */
export const createServiceLogger = (context: string): ServiceLogger => ({
    log: (message, extra) => Sentry.logger.info(message, toAttributes(context, extra)),
    warn: (message, extra) => Sentry.logger.warn(message, toAttributes(context, extra)),
    error: (message, extra) => Sentry.logger.error(message, toAttributes(context, extra)),
});

const stringify = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * Framework logger that routes Nest's internal logging to Sentry instead of stdout.
 *
 * @sideEffect emits log entries to Sentry.
 */
export class NestSentryLogger implements LoggerService {
    public log(message: unknown, context?: string): void {
        Sentry.logger.info(stringify(message), { context: context ?? 'nest' });
    }

    public error(message: unknown, stack?: string, context?: string): void {
        Sentry.logger.error(stringify(message), { context: context ?? 'nest', stack });
    }

    public warn(message: unknown, context?: string): void {
        Sentry.logger.warn(stringify(message), { context: context ?? 'nest' });
    }

    public debug(message: unknown, context?: string): void {
        Sentry.logger.debug(stringify(message), { context: context ?? 'nest' });
    }

    public verbose(message: unknown, context?: string): void {
        Sentry.logger.trace(stringify(message), { context: context ?? 'nest' });
    }
}
