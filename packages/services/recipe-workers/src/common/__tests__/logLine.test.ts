/**
 * The collapse from Powertools' call shape to Sentry's (plan U22a step 2).
 *
 * ⛔ WHY A SEPARATE, PURE FUNCTION. `logger.error` takes `(LogItemMessage, ...LogItemExtraInput)` — a message
 * that may be an OBJECT and a VARIADIC tail that may be `[Error]`, `[string]` or any number of attribute
 * objects. `reportErrorLine` takes `(string, Record<string, unknown>)`. Nothing casts between those two
 * honestly, and a cast is how the object-message form would have silently published `[object Object]` as an
 * issue title, grouping every such line into one. So the collapse is a value-level function with a test per
 * shape the TYPE admits — not per shape this package happens to use today.
 */
import { describe, expect, it } from 'vitest';

import { collapseLogLine } from '../logLine.js';

describe('collapseLogLine', () => {
    it('takes a string message through unchanged, with no attributes', () => {
        expect(collapseLogLine('a plain line', [])).toEqual({ message: 'a plain line', attributes: {} });
    });

    it('⛔ reads the message OUT of an object message and keeps its other keys as attributes', () => {
        // Without this branch the object would stringify to `[object Object]` and Sentry would group every
        // object-form line in the package into a single issue titled that.
        expect(collapseLogLine({ message: 'named', jobId: 'j1', attempt: 2 }, [])).toEqual({
            message: 'named',
            attributes: { jobId: 'j1', attempt: 2 },
        });
    });

    it('merges every attribute object in the variadic tail, later keys winning', () => {
        expect(
            collapseLogLine('m', [
                { a: 1, b: 2 },
                { b: 3, c: 4 },
            ]),
        ).toEqual({
            message: 'm',
            attributes: { a: 1, b: 3, c: 4 },
        });
    });

    /**
     * ⛔ MEASURED, not assumed. Against the real `@sentry/aws-serverless` 10.71.0 with a capturing transport,
     * `Sentry.logger.error('m', { error: new Error('rename failed') })` puts the literal two characters `{}`
     * in the envelope: the SDK JSON-stringifies any non-primitive attribute value, and an `Error`'s `message`
     * and `stack` are NON-ENUMERABLE. That is the same flattening step 1 fixed inside `scrubUnknown`, one
     * layer down inside the vendor — so diverting `logger.error` to Sentry REINTRODUCES it unless the render
     * happens here. `handlers/handleSyncWorker.ts:135` passes a caught value exactly this way.
     */
    it('⛔ RENDERS an Error rather than carrying it — Sentry would serialize one to the string `{}`', () => {
        const rendered = collapseLogLine('m', [new Error('boom')]).attributes['error'];

        expect(typeof rendered).toBe('string');
        expect(rendered).toContain('boom');
    });

    it('⛔ renders an Error passed as an attribute VALUE too — that is the shape the call sites use', () => {
        const { attributes } = collapseLogLine('m', [{ messageId: 'm-1', error: new Error('rename failed') }]);

        expect(attributes['messageId']).toBe('m-1');
        expect(typeof attributes['error']).toBe('string');
        expect(attributes['error']).toContain('rename failed');
    });

    /**
     * ⚠️ THE CAUSE CHAIN IS THE POINT, not the message. `error.stack` describes the outer error ALONE, so a
     * drizzle `DrizzleQueryError` renders as "Failed query" with the Postgres error that explains it dropped
     * — and this package runs every one of its database calls through drizzle. 18 call sites here hand-roll
     * `error instanceof Error ? error.message : String(error)`, which has that defect; they are not this
     * step's to convert, but nothing new may be written with it.
     */
    it('⛔ keeps the CAUSE of a wrapped error, which `.message` and `.stack` both drop', () => {
        const wrapped = new Error('Failed query', { cause: new Error('duplicate key value violates unique') });

        expect(collapseLogLine('m', [wrapped]).attributes['error']).toContain('duplicate key value violates unique');
    });

    it('leaves a non-Error thrown value as its string form rather than dropping it', () => {
        expect(collapseLogLine('m', [{ error: 'a bare string rejection' }]).attributes['error']).toBe(
            'a bare string rejection',
        );
    });

    it('files a bare string tail as `detail` rather than losing it', () => {
        expect(collapseLogLine('m', ['extra context'])).toEqual({
            message: 'm',
            attributes: { detail: 'extra context' },
        });
    });

    it('⚠️ an object message whose other keys collide with the tail loses to the tail, not the reverse', () => {
        // The tail is the per-call argument; the message object is the envelope. A caller who writes both
        // means the one they wrote second.
        expect(collapseLogLine({ message: 'm', attempt: 1 }, [{ attempt: 9 }])).toEqual({
            message: 'm',
            attributes: { attempt: 9 },
        });
    });

    it('is PURE — it mutates neither the message object nor any tail entry', () => {
        const message = { message: 'm', a: 1 };
        const tail = { b: 2 };

        collapseLogLine(message, [tail]);

        expect(message).toEqual({ message: 'm', a: 1 });
        expect(tail).toEqual({ b: 2 });
    });
});
