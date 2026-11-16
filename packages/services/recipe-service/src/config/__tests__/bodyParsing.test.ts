/**
 * Unit tests for {@link stripBodyParserRefusal}: a parser refusal travels on as `{ type, status, expose }` only, so
 * neither the request text in `body` nor the `SyntaxError` message that quotes it can reach the envelope or the log.
 * The integration tier (`importRoutes.integration.test.ts`) proves the same thing through the real stack.
 */
import { describe, expect, it, vi } from 'vitest';

import { stripBodyParserRefusal } from '../bodyParsing.js';

const MARKER = 'MARKER-cook-text';

/** Run the link and return what it handed `next`. */
function forwarded(error: unknown): unknown {
    const next = vi.fn<(error: unknown) => void>();

    stripBodyParserRefusal(error, undefined, undefined, next);
    expect(next).toHaveBeenCalledTimes(1);

    return next.mock.calls[0]?.[0];
}

describe('stripBodyParserRefusal', () => {
    it('forwards a parser refusal as its type, status and expose, and nothing else', () => {
        const refusal = Object.assign(new SyntaxError(`Unexpected token 'M', "${MARKER}"`), {
            type: 'entity.parse.failed',
            status: 400,
            statusCode: 400,
            expose: true,
            body: MARKER,
        });

        const result = forwarded(refusal);

        expect(result).toStrictEqual({ type: 'entity.parse.failed', status: 400, expose: true });
        expect(result).not.toBeInstanceOf(SyntaxError);
        expect(JSON.stringify(result)).not.toContain(MARKER);
    });

    it('passes any other error on unchanged', () => {
        const other = new Error('not a parser error');

        expect(forwarded(other)).toBe(other);
    });
});
