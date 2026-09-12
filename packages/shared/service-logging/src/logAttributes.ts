/**
 * Making a value safe to hand a telemetry sink — the PURE half of `@kitchensink/service-logging`.
 *
 * ⛔ THIS ENTRY IMPORTS NO SENTRY AND NO NEST, and that is why it is a subpath. `@kitchensink/service-logging`
 * proper depends on `@sentry/nestjs`, which an esbuild-bundled Lambda must not pull in — but
 * `recipe-workers` needs exactly this rule, because its `logger.error` now diverts to Sentry and would
 * otherwise publish an emptied error. Same shape as `@kitchensink/observability-scrubbers/denylist`, and for
 * the same reason: a pure subset of a package whose subject already covers the extra consumer.
 *
 * ⚠️ `renderThrowable` MOVED HERE from `@kitchensink/nest-error-envelope`, which is precisely named for "the
 * ONE Nest → `{ code, message, details? }` normalization". Rendering a thrown value for a LOG LINE is a
 * different piece of knowledge with a different reason to change, and it had grown two consumers outside
 * that package. No re-export was left behind: a forwarding line for a symbol the package no longer declares
 * is a contract restated so it can drift, and it would have cost `nest-error-envelope` its one virtue —
 * depending on `@nestjs/common` and nothing else.
 */
import { inspect } from 'node:util';

import { scrubText } from '@kitchensink/observability-scrubbers';

/**
 * How deep `inspect` follows nested values. A cause chain is one level per link, so this bounds how many links
 * are printed; `inspect` marks a cycle as `[Circular]` on its own, so it also terminates on a cause that points
 * back at an ancestor.
 */
const CAUSE_DEPTH = 6;

/**
 * Render a thrown value for a SERVER LOG, including its `cause` chain.
 *
 * ⛔ WHY NOT `exception.stack`: `Error.prototype.stack` describes the outer error ALONE. Drizzle wraps a driver
 * failure as `new DrizzleQueryError(…, { cause })`, so a stack-only log line says "Failed query" and nothing
 * under it — the Postgres error that explains it is dropped at the log line. `util.inspect` is Node's own
 * renderer for exactly this: it prints the stack, every own property (the
 * driver's SQLSTATE `code`, `severity`, …) and each `[cause]` in turn, and it handles a cyclic chain.
 *
 * ⚠️ FOR LOGS ONLY — never a response body. The envelope deliberately carries none of this (a stack fragment,
 * a connection string or a row's contents must not reach a caller).
 *
 * @param exception - Whatever was thrown.
 * @returns The rendered error with its causes, or the value's string form when it is not an `Error`. Pure.
 */
export function renderThrowable(exception: unknown): string {
    return exception instanceof Error ? inspect(exception, { depth: CAUSE_DEPTH }) : String(exception);
}

/**
 * How deep the attribute walk descends before it stops describing and starts marking. Log attributes are a
 * flat-ish bag by convention; past this the value is a payload, and a payload does not belong in a log line.
 */
const MAX_ATTRIBUTE_DEPTH = 6;

/** What replaces a value the walk refuses to descend into. */
const TRUNCATED = '[truncated]';

/** What replaces a value that points back at one of its own ancestors. */
const CIRCULAR = '[circular]';

/**
 * How much free text may reach a scrubber, in characters.
 *
 * ⛔ THIS IS A COST BOUND, NOT A STYLE LIMIT. `scrubText`'s email pattern backtracks quadratically —
 * measured with `'a'.repeat(n) + '@'`: 0.9 ms at 1 KB, 21 ms at 5 KB, 363 ms at 20 KB, and 2.24 SECONDS at
 * 50 KB, synchronously, on the request or worker thread. Scrubbing every string (rather than only rendered
 * errors) widened that exposure to attribute values, which can carry user-influenced text.
 *
 * ⚠️ SIZED AGAINST THE LARGEST REALISTIC VALUE rather than picked: a drizzle-shaped `pg` error wrapped five
 * deep renders to 1,184 characters through `renderThrowable`'s six-level `inspect`. 4 KiB leaves over 3x
 * headroom for that while bounding the pathological input to roughly 15 ms.
 */
const MAX_TEXT_LENGTH = 4_096;

/**
 * Bound a string, then scrub it.
 *
 * ⚠️ IN THAT ORDER. Scrubbing first would pay the unbounded cost this exists to avoid; and a value that was
 * shortened SAYS so, because a silently truncated stack trace reads as a complete one that simply ends.
 *
 * @param text - The free text.
 * @returns The bounded, scrubbed text. Pure.
 */
export function scrubLogText(text: string): string {
    const bounded = text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}… ${TRUNCATED}` : text;

    return scrubText(bounded);
}

/**
 * Render every `Error` in an attribute bag, at any depth, and scrub the free text that produces.
 *
 * ⛔ WHY THE SINK OWNS THIS RATHER THAN THE CALL SITES. Both of this package's sinks lose an `Error`:
 * `Sentry.logger.*` JSON-stringifies non-primitive attribute values (measured — the envelope receives the
 * literal `{}`), and the stdout path is `JSON.stringify` directly. `message` and `stack` are non-enumerable,
 * so both produce an empty object. A convention that every caller pre-stringifies is not a contract — it is
 * ~38 call sites remembering, and a forgotten one is INVISIBLE where a developer looks (no client locally
 * means the line goes to stdout, where it is at least present) and empty where it matters.
 *
 * ⛔ RENDER, THEN `scrubText`, AND THAT ORDER IS LOAD-BEARING. `scrubAttributes` judges a string as a WHOLE
 * — `looksLikeBearerToken(value) ? REDACTED : value` — against an UNANCHORED pattern, so one JWT-shaped
 * substring inside a multi-kilobyte `inspect` dump would replace the entire error text. It also never
 * applies the email or Clerk-`sub` patterns to a nested string; only `scrubText` does, and `scrubLog`
 * applies `scrubText` to a log's `message` and never to its attributes. This walk is the one place that
 * turns structured data into free text, so it owns the consequence.
 *
 * ⚠️ IT IS ALSO WHAT STOPS THE LOGGER KILLING ITS CALLER. `JSON.stringify` THROWS on a cyclic structure and
 * `scrubUnknown` recurses into one until the stack ends. Marking cycles and bounding depth here means a
 * caller can never be taken down by the attributes it chose to log.
 *
 * ⚠️ THE RETURN TYPE IS DELIBERATELY NOT `T`. A generic `<T>(attrs: T): T` would claim the bag comes back
 * with the same shape, and the entire purpose of this function is that it does not: an `Error` goes in and a
 * `string` comes out. That signature typechecked and was wrong, in the direction that hands a caller an
 * `Error`-typed value which is really text.
 *
 * @param attributes - The caller's attribute bag.
 * @returns A bag with the same KEYS, every `Error` rendered, EVERY string scrubbed — whether this walk
 *   produced it or the caller did — and cycles and over-deep values marked. Pure; the input is not mutated.
 */
export function renderLogAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
    return renderValue(attributes, new WeakSet<object>(), 0) as Record<string, unknown>;
}

/**
 * The walk behind {@link renderLogAttributes}.
 *
 * @param value - The value to render.
 * @param seen - Ancestors on the current path, for cycle detection.
 * @param depth - How far down this value sits.
 * @returns The rendered value. Pure.
 */
function renderValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
    if (value instanceof Error) {
        // ⛔ Rendered, never descended into. `inspect` already follows the cause chain, which is the whole
        // reason `renderThrowable` exists — walking an Error's own properties instead would reproduce the
        // flattening this function was written to prevent.
        return scrubLogText(renderThrowable(value));
    }

    // ⛔ EVERY STRING, not only one this walk rendered. A caller can hand over free text that is already a
    // rendered throwable — both `ApiExceptionFilter`s did exactly that, `logger.error(line,
    // renderThrowable(exception))` — and such a string would otherwise reach `scrubAttributes`, whose string
    // branch is a WHOLE-VALUE verdict against an unanchored bearer pattern. One token-shaped substring then
    // replaces the entire stack trace with `[redacted]`, and an email or Clerk `sub` in it is never touched
    // at all. `scrubText` is the surgical tool and it is idempotent, so applying it here costs a pass over
    // strings that are already clean and nothing else.
    if (typeof value === 'string') {
        return scrubLogText(value);
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (seen.has(value)) {
        return CIRCULAR;
    }

    if (depth >= MAX_ATTRIBUTE_DEPTH) {
        return TRUNCATED;
    }

    seen.add(value);

    try {
        if (Array.isArray(value)) {
            return value.map((entry) => renderValue(entry, seen, depth + 1));
        }

        // ⛔ NULL-PROTOTYPE ACCUMULATOR. The keys are the CALLER'S — a caller logging a payload logs whatever
        // keys that payload has — so an attribute named `__proto__` reached the inherited setter instead of
        // defining a property, and vanished from the rendered line. A logger may not be the thing that deletes
        // the field it was handed.
        const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            out[key] = renderValue(nested, seen, depth + 1);
        }

        return out;
    } finally {
        // ⚠️ Removed on the way OUT, so `seen` tracks the current PATH rather than everything visited. A bag
        // that names one shared object twice as siblings is not a cycle, and reporting it as one would lose
        // a value the caller deliberately logged.
        seen.delete(value);
    }
}
