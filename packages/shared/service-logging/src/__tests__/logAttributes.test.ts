import { describe, expect, it } from 'vitest';

import { renderLogAttributes, renderThrowable } from '../logAttributes.js';

/** The shape `pg` raises: an `Error` carrying SQLSTATE fields as own properties. */
function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code, severity: 'FATAL' });
}

describe('renderThrowable', () => {
    it('includes the CAUSE, which a bare `.stack` never does', () => {
        // Drizzle wraps the driver error as `cause`, and a stack-only log line says only "Failed query"
        // because `Error.prototype.stack` is the outer error's alone.
        const driver = pgError('terminating connection due to administrator command', '57P01');
        const wrapped = new Error('Failed query: select 1', { cause: driver });

        const rendered = renderThrowable(wrapped);

        expect(wrapped.stack).not.toContain('terminating connection');
        expect(rendered).toContain('Failed query: select 1');
        expect(rendered).toContain('terminating connection due to administrator command');
        expect(rendered).toContain('57P01');
    });

    it('follows a cause chain more than one level deep', () => {
        const root = pgError('password authentication failed', '28P01');
        const middle = new Error('connect failed', { cause: root });
        const outer = new Error('Failed query', { cause: middle });

        const rendered = renderThrowable(outer);

        expect(rendered).toContain('connect failed');
        expect(rendered).toContain('password authentication failed');
        expect(rendered).toContain('28P01');
    });

    it('terminates on a cyclic cause', () => {
        const a = new Error('a');
        const b = new Error('b', { cause: a });

        Object.assign(a, { cause: b });

        expect(renderThrowable(a)).toContain('a');
    });

    it('renders a thrown non-Error as its string form', () => {
        expect(renderThrowable('plain string')).toBe('plain string');
        expect(renderThrowable(42)).toBe('42');
    });
});

/**
 * `renderLogAttributes` — the walk that makes an attribute bag safe to hand a telemetry sink.
 *
 * ⛔ THE DEFECT IT EXISTS FOR, MEASURED against `@sentry/aws-serverless` 10.71.0 with a capturing
 * transport: `Sentry.logger.error('m', { error: new Error('rename failed') })` puts the literal two
 * characters `{}` in the envelope. The SDK JSON-stringifies any non-primitive attribute value and an
 * `Error`'s `message` and `stack` are NON-ENUMERABLE. The stdout path loses it identically, because that
 * path is also `JSON.stringify`. So the render must sit UPSTREAM of the fork, which is here.
 *
 * ⛔ AND IT COMPOSES WITH A SEAM THAT WAS CUT FOR IT. `scrubUnknown` returns an `Error` UNTOUCHED, on
 * purpose, so that a downstream renderer can have it — in recipe-workers that renderer was Powertools. A
 * sink has no Powertools, so if this walk does not render, nothing does.
 */
describe('renderLogAttributes', () => {
    it('⛔ renders a top-level Error, which every sink here would otherwise serialize to `{}`', () => {
        const rendered = renderLogAttributes({ messageId: 'm-1', error: new Error('rename failed') });

        expect(rendered['messageId']).toBe('m-1');
        expect(rendered['error']).toContain('rename failed');
        expect(JSON.stringify(rendered)).toContain('rename failed');
    });

    it('⛔ renders a NESTED Error — the shape a caller reaches the moment they group attributes', () => {
        const rendered = renderLogAttributes({ ctx: { attempt: 2, error: new Error('deep failure') } });

        expect(JSON.stringify(rendered)).toContain('deep failure');
    });

    it('renders an Error inside an array', () => {
        const rendered = renderLogAttributes({ failures: [new Error('first'), new Error('second')] });

        expect(JSON.stringify(rendered)).toContain('first');
        expect(JSON.stringify(rendered)).toContain('second');
    });

    /**
     * ⛔ RENDER FIRST, THEN `scrubText` — and the ordering is not interchangeable, because the two
     * scrubbers have different reach:
     *
     * - `scrubAttributes` judges a STRING AS A WHOLE (`looksLikeBearerToken(value) ? REDACTED : value`),
     *   and the bearer pattern is unanchored. One JWT-shaped substring anywhere inside a 4 KB
     *   `util.inspect` dump therefore replaces the ENTIRE error text with `[redacted]` — the token is
     *   protected and the error is destroyed.
     * - `scrubAttributes` never applies the email or Clerk-`sub` patterns to a nested string at all; only
     *   `scrubText` does, and `scrubLog` applies `scrubText` to a log's `message` and never to its
     *   attributes.
     *
     * So a rendered error is free text that nothing else would redact, and `scrubText` is the surgical
     * tool: it replaces the secret in place and leaves the rest intact.
     */
    it('⛔ scrubs the rendered text IN PLACE — the error survives and the secret does not', () => {
        const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g';
        const leaky = new Error(`refresh failed for someone@example.com with ${token}`);

        const rendered = renderLogAttributes({ error: leaky })['error'] as string;

        expect(rendered).toContain('refresh failed for');
        expect(rendered).not.toContain('someone@example.com');
        expect(rendered).not.toContain(token);
    });

    /**
     * ⛔ A logger may never be the thing that takes out its caller. `JSON.stringify` THROWS on a cycle and
     * `scrubUnknown` recurses into one until the stack ends — and both run downstream of this walk, so a
     * caller logging a self-referential object would be killed by the line it chose to log.
     *
     * ⚠️ The marker is asserted, not merely the absence of a throw. The depth bound ALONE stops the throw
     * (six levels, then `[truncated]`), so a test that only checked for no-throw passed with the cycle
     * guard deleted — verified by removing it. What the guard actually buys is SHAPE and SIZE: the cycle is
     * named where it occurs instead of being expanded six levels deep, which on a wide object is the
     * difference between one line and a very large one, on an org already shedding events to rate limits.
     */
    it('⛔ marks a CYCLE where it occurs rather than expanding it to the depth bound', () => {
        const cyclic: Record<string, unknown> = { id: 'j-1' };
        cyclic['self'] = cyclic;

        const rendered = renderLogAttributes({ job: cyclic });

        expect(() => JSON.stringify(rendered)).not.toThrow();
        expect(JSON.stringify(rendered)).toContain('j-1');
        expect((rendered['job'] as Record<string, unknown>)['self']).toBe('[circular]');
    });

    it('⚠️ does NOT report a shared sibling as a cycle — `seen` tracks the path, not every value visited', () => {
        const shared = { source: 'usda' };

        expect(renderLogAttributes({ first: shared, second: shared })).toEqual({
            first: { source: 'usda' },
            second: { source: 'usda' },
        });
    });

    it('bounds depth rather than following a payload into a log line', () => {
        const deep = { a: { b: { c: { d: { e: { f: { g: 'too far' } } } } } } };

        expect(JSON.stringify(renderLogAttributes(deep))).toContain('[truncated]');
    });

    /**
     * ⛔ BOUNDED BEFORE SCRUBBED, because scrubbing an unbounded string is a denial of service the logger
     * inflicts on its own caller. `scrubText`'s email pattern backtracks quadratically: measured on this
     * machine, `'a'.repeat(n) + '@'` costs 0.9 ms at 1 KB, 21 ms at 5 KB, 363 ms at 20 KB and 2.24 SECONDS
     * at 50 KB — synchronously, on the request or worker thread. That cost existed before, on error messages
     * only; making the walk scrub EVERY string widened the input surface to attribute values, which can
     * carry user-influenced text (a recipe title, an ingredient phrase, a search query).
     *
     * ⚠️ THE CAP IS SIZED AGAINST THE LARGEST REALISTIC VALUE, not guessed: a drizzle-shaped `pg` error
     * wrapped five deep renders to 1,184 characters, so 4 KiB leaves more than 3x headroom while bounding
     * the pathological case to ~15 ms. A truncated value says so, because a silently shortened stack trace
     * is worse than a short one.
     */
    it('⛔ bounds a string before scrubbing it, and says that it did', () => {
        const rendered = renderLogAttributes({ note: `${'a'.repeat(6_000)}@` })['note'] as string;

        expect(rendered.length).toBeLessThan(5_000);
        expect(rendered).toContain('[truncated]');
    });

    it('⚠️ leaves a realistically-sized rendered error whole — the cap must not cost a cause chain', () => {
        const driver = Object.assign(new Error('terminating connection'), { code: '57P01' });
        const wrapped = new Error('Failed query: select 1', { cause: driver });

        const rendered = renderLogAttributes({ error: wrapped })['error'] as string;

        expect(rendered).not.toContain('[truncated]');
        expect(rendered).toContain('57P01');
    });

    it('leaves primitives, null and plain strings exactly as they were', () => {
        const attributes = { a: 1, b: 'two', c: true, d: null, e: undefined };

        expect(renderLogAttributes(attributes)).toEqual(attributes);
    });

    it('is PURE — the caller’s object is not mutated', () => {
        const failure = new Error('boom');
        const attributes = { error: failure };

        renderLogAttributes(attributes);

        expect(attributes.error).toBe(failure);
    });

    /**
     * ⛔ THE ATTRIBUTE BAG'S KEYS ARE THE CALLER'S, and a caller logging a payload logs whatever keys the
     * payload has. Rendering onto an object LITERAL meant `__proto__` reached the inherited setter instead
     * of defining a property: the attribute vanished from the rendered line, and what it carried travelled
     * with the merge. A logger may not be the thing that deletes the field it was handed.
     */
    it('⛔ renders a `__proto__` attribute as DATA and pollutes nothing', () => {
        const rendered = renderLogAttributes({ ['__proto__']: { polluted: 'yes' }, jobId: 'j-1' });

        expect(Object.hasOwn(rendered, '__proto__')).toBe(true);
        expect(rendered['jobId']).toBe('j-1');
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
});
