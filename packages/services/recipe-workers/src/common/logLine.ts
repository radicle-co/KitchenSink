/**
 * Collapse a Powertools log call into the `(message, attributes)` pair a Sentry log entry is made of.
 *
 * ⛔ WHY THIS IS A FUNCTION AND NOT A CAST. `logger.error` accepts Powertools' `LogItemMessage` — a string OR
 * an object carrying its own `message` — and a VARIADIC `LogItemExtraInput`, which the library types as
 * `[Error | string] | LogAttributes[]`. `reportErrorLine` accepts `(string, Record<string, unknown>)`. A cast
 * between those two compiles and is wrong in the one direction nobody would notice: an object-form message
 * stringifies to `[object Object]`, and Sentry groups issues BY TITLE, so every object-form line in the
 * package would land in a single issue named that.
 *
 * ⛔ AND EVERY `Error` IS RENDERED, through the SHARED rule. Measured against the real SDK: an `Error` left
 * in a Sentry log attribute arrives as the literal two characters `{}`, because the SDK JSON-stringifies
 * non-primitive attribute values and `message`/`stack` are non-enumerable. That is the same flattening step
 * 1 fixed inside `scrubUnknown` — which passes an `Error` through WHOLE on purpose, so that a downstream
 * renderer can have it. On the stdout path that renderer is Powertools; on this path it is
 * `renderLogAttributes`.
 *
 * ⚠️ IMPORTED FROM THE PURE `./logAttributes` SUBPATH, never the package root. The root pulls
 * `@sentry/nestjs`, which these esbuild-bundled Lambdas must not carry — they use `@sentry/aws-serverless`.
 * Same split, same reason, as `@kitchensink/observability-scrubbers/denylist`.
 */
import type { LogItemExtraInput, LogItemMessage } from '@aws-lambda-powertools/logger/types';

import { renderLogAttributes } from '@kitchensink/service-logging/logAttributes';

/** A log call reduced to Sentry's shape. */
export interface CollapsedLogLine {
    /** The line's text — the issue title Sentry groups on. */
    readonly message: string;
    /** Everything else the caller passed, merged. */
    readonly attributes: Record<string, unknown>;
}

/**
 * Reduce a Powertools call to a message and one attribute bag.
 *
 * @param message - The message argument, string or object form.
 * @param extra - The variadic tail exactly as Powertools received it.
 * @returns The collapsed line. Pure — neither argument is mutated.
 */
export function collapseLogLine(message: LogItemMessage, extra: LogItemExtraInput): CollapsedLogLine {
    const attributes: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let text: string;

    if (typeof message === 'string') {
        text = message;
    } else {
        const { message: nested, ...rest } = message;

        text = nested;
        Object.assign(attributes, rest);
    }

    for (const entry of extra) {
        if (entry instanceof Error) {
            attributes['error'] = entry;
        } else if (typeof entry === 'string') {
            attributes['detail'] = entry;
        } else {
            Object.assign(attributes, entry);
        }
    }

    return { message: text, attributes: renderLogAttributes(attributes) };
}
