/**
 * Unit tests for {@link normalizeBodyParserError}: the body parser's refusals are the caller's `4xx`, not a server fault.
 *
 * The parser throws `http-errors` objects, which are NOT Nest `HttpException`s, so without this link a filter's 500
 * fallback answered them: a client that shrinks a chunk on `413` never saw the status it branches on, and a malformed
 * JSON body (which carries the request text as `body`) was logged and reported as a server fault.
 *
 * ⛔ Every published message is a CONSTANT: the thrown object carries `body` (the cook's request text) and the parser's
 * own message, and none of it may reach the response.
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
    BODY_ENCODING_UNSUPPORTED_MESSAGE,
    BODY_NOT_PARSEABLE_MESSAGE,
    BODY_TOO_LARGE_MESSAGE,
    normalizeBodyParserError,
} from '../bodyParserError.js';
import { GENERIC_STATUS_CODES } from '../envelope.js';

const VOCABULARY = {
    validationFailedCode: 'VALIDATION_FAILED',
    statusCode: { ...GENERIC_STATUS_CODES, 413: 'TOO_BIG', 415: 'WRONG_MEDIA' },
};

const MARKER = 'MARKER-recipe-text-9f3a';

/** An `http-errors` object as body-parser raises it. */
function parserError(type: string, status: number, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(`parser said: ${MARKER}`), {
        type,
        status,
        statusCode: status,
        expose: true,
        ...extra,
    });
}

describe('normalizeBodyParserError', () => {
    it.each([
        ['entity.too.large', 413, HttpStatus.PAYLOAD_TOO_LARGE, 'TOO_BIG', BODY_TOO_LARGE_MESSAGE],
        ['entity.parse.failed', 400, HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', BODY_NOT_PARSEABLE_MESSAGE],
        [
            'encoding.unsupported',
            415,
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            'WRONG_MEDIA',
            BODY_ENCODING_UNSUPPORTED_MESSAGE,
        ],
        [
            'charset.unsupported',
            415,
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            'WRONG_MEDIA',
            BODY_ENCODING_UNSUPPORTED_MESSAGE,
        ],
    ])(
        'answers %s as %i with the vocabulary’s own code and a constant message',
        (type, status, answer, code, message) => {
            const error = parserError(type, status, { body: `{"title": "${MARKER}` });

            expect(normalizeBodyParserError(error, VOCABULARY)).toEqual({ status: answer, body: { code, message } });
        },
    );

    it('never puts the parser’s text or the request body on the wire', () => {
        const error = parserError('entity.parse.failed', 400, { body: `{"title": "${MARKER}` });

        expect(JSON.stringify(normalizeBodyParserError(error, VOCABULARY))).not.toContain(MARKER);
    });

    it.each([
        ['an error that merely carries a 413', Object.assign(new Error('x'), { status: 413 })],
        ['a parser type that is not exposed', parserError('entity.parse.failed', 400, { expose: false })],
        ['a parser type with a 5xx status', parserError('entity.parse.failed', 500)],
        ['a parser type with no status', Object.assign(new Error('x'), { type: 'entity.parse.failed', expose: true })],
        ['a parser type a link does not name', parserError('request.aborted', 400)],
        ['a plain Error', new Error('x')],
        ['null', null],
        ['a string', 'entity.too.large'],
    ])('does not claim %s', (_name, thrown) => {
        expect(normalizeBodyParserError(thrown, VOCABULARY)).toBeUndefined();
    });
});
