/**
 * Unit tests for {@link normalizeUnstorableText}: the PostgreSQL text rejection (`22021`, `22P05`) is the caller's
 * `400`, wherever in the cause chain the driver error sits.
 *
 * The errors here are STRUCTURAL stand-ins for `pg`'s `DatabaseError` and drizzle's `DrizzleQueryError` — this
 * package declares neither driver. Each service's filter integration test throws the REAL classes, and each
 * service's LOCAL e2e sends a real NUL to a real PostgreSQL, so the shapes asserted here are pinned there too.
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { GENERIC_STATUS_CODES } from '../envelope.js';
import { normalizeUnstorableText, UNSTORABLE_TEXT_MESSAGE } from '../unstorableText.js';

/** A vocabulary standing in for a service's own, so the code is read from it rather than assumed. */
const VOCABULARY = { validationFailedCode: 'VALIDATION_FAILED', statusCode: GENERIC_STATUS_CODES };

/** The text a caller sent, which must never be echoed back. */
const CALLER_TEXT = 'Grandma secret blend';

/**
 * A `pg` `DatabaseError` as the driver builds it: `name` is the protocol message name, `code` the SQLSTATE.
 *
 * @param code - The SQLSTATE.
 * @returns The error.
 */
function makeDriverError(code: string): Error {
    return Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
        name: 'error',
        code,
        severity: 'ERROR',
    });
}

/**
 * A `DrizzleQueryError` as drizzle builds it: the SQL and the bound parameters in the message, the driver error as
 * the `cause`.
 *
 * @param cause - The driver error.
 * @returns The error.
 */
function makeQueryError(cause: unknown): Error {
    return new Error(`Failed query: insert into "food" ("name") values ($1)\nparams: ${CALLER_TEXT}\u0000`, { cause });
}

describe('normalizeUnstorableText', () => {
    it.each([
        ['22021', 'a NUL in a text parameter'],
        ['22P05', 'a NUL escape in a jsonb parameter'],
    ])('answers SQLSTATE %s (%s) with a 400 in the service validation code', (code) => {
        expect(normalizeUnstorableText(makeDriverError(code), VOCABULARY)).toEqual({
            status: HttpStatus.BAD_REQUEST,
            body: {
                code: 'VALIDATION_FAILED',
                message: UNSTORABLE_TEXT_MESSAGE,
                details: { fields: [UNSTORABLE_TEXT_MESSAGE] },
            },
        });
    });

    it('finds the driver error as the cause of a query error, which is how drizzle throws it', () => {
        const failure = normalizeUnstorableText(makeQueryError(makeDriverError('22021')), VOCABULARY);

        expect(failure?.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('finds the driver error under a service error that wrapped the query error', () => {
        const wrapped = new Error('could not save the food', { cause: makeQueryError(makeDriverError('22P05')) });

        expect(normalizeUnstorableText(wrapped, VOCABULARY)?.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('publishes the code from the vocabulary it is given', () => {
        const identity = { validationFailedCode: 'BAD_REQUEST', statusCode: GENERIC_STATUS_CODES };

        expect(normalizeUnstorableText(makeDriverError('22021'), identity)?.body.code).toBe('BAD_REQUEST');
    });

    it('never echoes the SQL, the parameters or the driver message into the body', () => {
        const serialized = JSON.stringify(
            normalizeUnstorableText(makeQueryError(makeDriverError('22021')), VOCABULARY),
        );

        expect(serialized).not.toContain(CALLER_TEXT);
        expect(serialized).not.toContain('Failed query');
        expect(serialized).not.toContain('UTF8');
    });

    it.each([
        ['a unique violation', makeDriverError('23505')],
        ['a value too long for its column', makeDriverError('22001')],
        ['a connection failure', makeDriverError('08006')],
        ['a query error over another SQLSTATE', makeQueryError(makeDriverError('40001'))],
        ['a SQLSTATE spelled as a number', Object.assign(new Error('x'), { code: 22021 })],
        ['a plain error', new Error('boom')],
        ['a string', '22021'],
        ['null', null],
        ['undefined', undefined],
    ])('leaves %s to the caller, so it stays a server fault', (_label, exception) => {
        expect(normalizeUnstorableText(exception, VOCABULARY)).toBeUndefined();
    });

    it('terminates on a cyclic cause chain that holds no match', () => {
        const first = new Error('first');
        const second = new Error('second', { cause: first });
        Object.assign(first, { cause: second });

        expect(normalizeUnstorableText(first, VOCABULARY)).toBeUndefined();
    });
});
