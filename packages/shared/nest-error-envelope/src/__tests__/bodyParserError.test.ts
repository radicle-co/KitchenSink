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
import { describe, expect, it, vi } from 'vitest';

import {
    BODY_ENCODING_UNSUPPORTED_MESSAGE,
    BODY_INCOMPLETE_MESSAGE,
    BODY_LENGTH_MISMATCH_MESSAGE,
    BODY_NOT_PARSEABLE_MESSAGE,
    BODY_TOO_LARGE_MESSAGE,
    normalizeBodyParserError,
    stripBodyParserRefusal,
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
        // raw-body: the bytes read do not match the declared `content-length`.
        ['request.size.invalid', 400, HttpStatus.BAD_REQUEST, 'BAD_REQUEST', BODY_LENGTH_MISMATCH_MESSAGE],
        // raw-body: the client closed the connection before the body arrived.
        ['request.aborted', 400, HttpStatus.BAD_REQUEST, 'BAD_REQUEST', BODY_INCOMPLETE_MESSAGE],
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
        ['a parser type a link does not name', parserError('stream.not.readable', 400)],
        ['a type that is an inherited property name: constructor', parserError('constructor', 400)],
        ['a type that is an inherited property name: __proto__', parserError('__proto__', 400)],
        ['a type that is an inherited property name: toString', parserError('toString', 400)],
        ['a plain Error', new Error('x')],
        ['null', null],
        ['a string', 'entity.too.large'],
    ])('does not claim %s', (_name, thrown) => {
        expect(normalizeBodyParserError(thrown, VOCABULARY)).toBeUndefined();
    });
});

describe('stripBodyParserRefusal', () => {
    /** Run the link and return what it handed `next`. */
    function forwarded(error: unknown): unknown {
        const next = vi.fn<(error: unknown) => void>();

        stripBodyParserRefusal(error, undefined, undefined, next);
        expect(next).toHaveBeenCalledTimes(1);

        return next.mock.calls[0]?.[0];
    }

    it('forwards a refusal the normaliser claims as its type, status and expose, and nothing else', () => {
        const refusal = Object.assign(new SyntaxError(`Unexpected token 'M', "${MARKER}"`), {
            type: 'entity.parse.failed',
            status: 400,
            statusCode: 400,
            expose: true,
            body: MARKER,
        });

        const result = forwarded(refusal);

        expect(result).toStrictEqual({ type: 'entity.parse.failed', status: 400, expose: true });
        expect(normalizeBodyParserError(result, VOCABULARY)?.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('passes any other error on as the same object, without the request body it carried', () => {
        const other = parserError('stream.not.readable', 500, { body: MARKER });

        const result = forwarded(other);

        expect(result).toBe(other);
        expect(Object.hasOwn(other, 'body')).toBe(false);
        expect(other.message).toContain('parser said');
    });

    it('passes an error that carries no body on unchanged', () => {
        const plain = new Error('not a parser error');

        expect(forwarded(plain)).toBe(plain);
        expect(forwarded('a string')).toBe('a string');
    });
});
