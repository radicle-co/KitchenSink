/**
 * Nest's framework logger, routed through the sink.
 *
 * ⛔ IT IS NOT CALLED `NestSentryLogger`, AND THE NAME IS THE RULING. Under `logRouting.ts` most lines go to
 * stdout, not to Sentry — a Sentry name would lie on the majority path, which is how its predecessor came
 * to write NOTHING to stdout and delete every line on any run without a DSN.
 *
 * ⛔ WIRING THIS INTO `NestFactory.create` IS WHAT ROUTES A SERVICE. `create(mod, { logger })` calls
 * `Logger.overrideLogger(logger)`, and Nest's `Logger` resolves that static at CALL time — so every existing
 * `new Logger(X.name)` in the service, including instances constructed at module load before the app
 * exists, routes here with no edit. Deleting those call sites is a separate, cosmetic question; passing this
 * to `create` is the change.
 *
 * ⛔ AND IT MUST NEVER FALL BACK TO NEST'S `Logger`. After `overrideLogger` that static is this object, so a
 * fallback through it recurses without bound. The sink is the only thing this may call.
 */
import type { LoggerService } from '@nestjs/common';

import { emitLogRecord } from './logSink.js';
import type { LogLevel } from './logRouting.js';

/** What a line is attributed to when Nest supplies no context. */
const FRAMEWORK_CONTEXT = 'nest';

/**
 * Render whatever Nest passed as a message.
 *
 * ⚠️ Nest logs objects (`RouterExplorer` route maps, validation payloads). Left to `String`, every one of
 * them becomes `[object Object]` — and Sentry groups issues by title, so they would all become one.
 *
 * @param value - The message argument.
 * @returns Its text. Pure.
 */
function messageText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Split Nest's variadic tail into attributes.
 *
 * ⛔ THE SHAPE IS MEASURED, not assumed: Nest appends the CONTEXT as the final argument and passes
 * everything between the message and it through untouched, so `logger.warn('msg', { … })` arrives here as
 * `('msg', { … }, 'MyService')`. An adapter typed `(message, context?: string)` would bind that attributes
 * object to `context` and stringify a structured bag into a name field.
 *
 * @param params - Everything Nest passed after the message.
 * @param stackKey - Where to file a non-final string. `error` receives the stack there; other levels do not.
 * @returns The attribute bag, always carrying a `context`. Pure.
 */
function tailAttributes(params: readonly unknown[], stackKey: 'stack' | 'detail'): Record<string, unknown> {
    const rest = [...params];
    const last = rest.at(-1);
    let context = FRAMEWORK_CONTEXT;

    if (typeof last === 'string') {
        context = last;
        rest.pop();
    }

    const attributes: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

    for (const param of rest) {
        if (typeof param === 'string') {
            attributes[stackKey] = param;
        } else if (param !== null && typeof param === 'object') {
            Object.assign(attributes, param);
        }
    }

    attributes['context'] = context;

    return attributes;
}

/**
 * Route Nest's own bootstrap, route-mapping and exception output through the sink.
 *
 * @sideEffect Its methods emit log records.
 */
export class NestRoutedLogger implements LoggerService {
    /** @inheritdoc */
    public log(message: unknown, ...params: unknown[]): void {
        this.emit('info', message, params);
    }

    /** @inheritdoc */
    public warn(message: unknown, ...params: unknown[]): void {
        this.emit('warn', message, params);
    }

    /** @inheritdoc */
    public error(message: unknown, ...params: unknown[]): void {
        emitLogRecord('error', messageText(message), tailAttributes(params, 'stack'));
    }

    /** @inheritdoc */
    public debug(message: unknown, ...params: unknown[]): void {
        this.emit('debug', message, params);
    }

    /**
     * @inheritdoc
     * ⚠️ `verbose` maps to `debug`: the routing rule knows four levels, and both are stdout-only, so a fifth
     * would be a distinction the sink could not act on.
     */
    public verbose(message: unknown, ...params: unknown[]): void {
        this.emit('debug', message, params);
    }

    /**
     * Emit one record for a non-error level.
     *
     * @param level - The routed level.
     * @param message - Nest's message argument.
     * @param params - Nest's variadic tail.
     * @sideEffect Emits a log record.
     */
    private emit(level: LogLevel, message: unknown, params: readonly unknown[]): void {
        emitLogRecord(level, messageText(message), tailAttributes(params, 'detail'));
    }
}
