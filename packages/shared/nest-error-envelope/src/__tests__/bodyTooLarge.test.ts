/**
 * Unit tests for {@link normalizeBodyTooLarge}: the body parser's oversized-body refusal is the caller's `413`.
 *
 * The parser throws an `http-errors` object, which is NOT a Nest `HttpException`, so without this link a filter's
 * 500 fallback answered it and a client that shrinks a chunk on `413` never saw the status it branches on.
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { normalizeBodyTooLarge, BODY_TOO_LARGE_MESSAGE } from '../bodyTooLarge.js';
import { GENERIC_STATUS_CODES } from '../envelope.js';

const VOCABULARY = {
    validationFailedCode: 'VALIDATION_FAILED',
    statusCode: { ...GENERIC_STATUS_CODES, 413: 'TOO_BIG' },
};

describe('normalizeBodyTooLarge', () => {
    it('answers the parser’s entity.too.large error as 413, with the vocabulary’s own code and a constant message', () => {
        const error = Object.assign(new Error('request entity too large: 150000 bytes of secret'), {
            status: 413,
            type: 'entity.too.large',
        });

        expect(normalizeBodyTooLarge(error, VOCABULARY)).toEqual({
            status: HttpStatus.PAYLOAD_TOO_LARGE,
            body: { code: 'TOO_BIG', message: BODY_TOO_LARGE_MESSAGE },
        });
    });

    it.each([
        ['an error that merely carries a 413', Object.assign(new Error('x'), { status: 413 })],
        ['a different parser error', Object.assign(new Error('x'), { type: 'entity.parse.failed' })],
        ['a plain Error', new Error('x')],
        ['null', null],
        ['a string', 'entity.too.large'],
    ])('does not claim %s', (_name, thrown) => {
        expect(normalizeBodyTooLarge(thrown, VOCABULARY)).toBeUndefined();
    });
});
