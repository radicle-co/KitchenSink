/**
 * The per-class logging facade — `createServiceLogger(MyService.name)` in place of `new Logger(MyService.name)`.
 *
 * ⚠️ THE SIGNATURE IS IDENTITY'S, UNCHANGED, on purpose. Its six adopters are not edited by this change, so
 * the diff reads as what it is: the destination moved, the call sites did not. What moved is that a line no
 * longer CEASES TO EXIST when no Sentry client is initialised — see `logRouting.ts` for the defect.
 */
import { emitLogRecord } from './logSink.js';

/** What a call site may pass beside the message. */
export type LogExtra = Record<string, unknown> | string | undefined;

/** The three levels a service class logs at. */
export interface ServiceLogger {
    /** Informational. Stays on stdout. */
    log: (message: string, extra?: LogExtra) => void;
    /** Recoverable degradation. Stays on stdout. */
    warn: (message: string, extra?: LogExtra) => void;
    /** A real failure. Diverts to the service's own Sentry project when a client exists. */
    error: (message: string, extra?: LogExtra) => void;
}

/**
 * Normalise the three shapes a call site may pass into one attribute bag.
 *
 * ⚠️ `context` is applied LAST so an extra cannot overwrite it. A line attributed to the wrong class is
 * worse than a dropped field: it sends an operator to the wrong module.
 *
 * @param context - The class or component name.
 * @param extra - Whatever the call site passed.
 * @returns The attribute bag. Pure.
 */
export function toAttributes(context: string, extra: LogExtra): Record<string, unknown> {
    if (extra === undefined) {
        return { context };
    }

    if (typeof extra === 'string') {
        return { detail: extra, context };
    }

    return { ...extra, context };
}

/**
 * A logger bound to one context.
 *
 * @param context - The class or component name every line is tagged with.
 * @returns The logger.
 * @sideEffect Its methods emit log records.
 */
export const createServiceLogger = (context: string): ServiceLogger => ({
    log: (message, extra) => emitLogRecord('info', message, toAttributes(context, extra)),
    warn: (message, extra) => emitLogRecord('warn', message, toAttributes(context, extra)),
    error: (message, extra) => emitLogRecord('error', message, toAttributes(context, extra)),
});
