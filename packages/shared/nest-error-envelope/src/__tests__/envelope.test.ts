/**
 * Unit tests for the shared Nest→envelope normalization.
 *
 * These are the MECHANISM's tests, and they exist at this layer for a reason the extraction made visible: while
 * the logic was copied into three filters, each service's suite tested its own copy, so a branch ABSENT from a copy
 * had no test anywhere. Identity's missing explicit-code branch is exactly that: its filter test suite was
 * thorough and could not possibly have caught it. Testing the mechanism once, here, is what makes "every service
 * has this branch" checkable.
 *
 * Each service keeps its own filter test for what is genuinely its own — its domain-error branch, its logging, its
 * status table, and (critically) driving the REAL `ZodValidationPipe` so a `nestjs-zod` change that moved the
 * issues off `errors` fails a test rather than degrading the wire.
 */
import { BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
    asExplicitEnvelope,
    asValidationEnvelope,
    codeForStatus,
    describeBody,
    describeIssue,
    normalizeHttpException,
    FRAMEWORK_KEYS,
    GENERIC_STATUS_CODES,
    UNSPECIFIED_MESSAGE,
} from '../envelope.js';

/** A vocabulary standing in for a service's own, so the parameterization is exercised rather than assumed. */
const VOCABULARY = {
    validationFailedCode: 'VALIDATION_FAILED',
    statusCode: { ...GENERIC_STATUS_CODES, [HttpStatus.NOT_FOUND]: 'ROUTE_NOT_FOUND' },
};

describe('describeIssue', () => {
    it('prefixes the constraint with the field path, which is what makes it usable', () => {
        expect(describeIssue({ path: ['user', 'email'], message: 'Invalid email' })).toBe('user.email: Invalid email');
    });

    // `z.strictObject`'s `unrecognized_keys` issue has an EMPTY path — the OBJECT failed, not a property — so the
    // prefix must be omitted rather than rendered as a bare `': '`.
    it('renders a path-less issue bare, with no empty field prefix', () => {
        expect(describeIssue({ path: [], message: 'Unrecognized key: "hacker"' })).toBe('Unrecognized key: "hacker"');
    });

    it('drops a symbol path segment rather than stringifying it', () => {
        expect(describeIssue({ path: ['a', Symbol('s'), 2], message: 'nope' })).toBe('a.2: nope');
    });

    it.each([
        ['a non-object', 'not an issue'],
        ['null', null],
        ['no message', { path: ['a'] }],
        ['an empty message', { path: ['a'], message: '' }],
        ['a non-string message', { path: ['a'], message: 42 }],
    ])('returns undefined for %s, so an unrecognised shape degrades instead of emitting junk', (_label, issue) => {
        expect(describeIssue(issue)).toBeUndefined();
    });
});

describe('asValidationEnvelope', () => {
    it("lifts every renderable issue into details.fields under the service's own code", () => {
        const body = { statusCode: 400, message: 'Validation failed', errors: [{ path: ['a'], message: 'too small' }] };

        expect(asValidationEnvelope(body, 'VALIDATION_FAILED')).toEqual({
            code: 'VALIDATION_FAILED',
            message: 'a: too small',
            details: { fields: ['a: too small'] },
        });
    });

    it('uses the code it is GIVEN, so identity can keep BAD_REQUEST while recipe uses VALIDATION_FAILED', () => {
        const body = { errors: [{ path: ['a'], message: 'too small' }] };

        expect(asValidationEnvelope(body, 'BAD_REQUEST')?.code).toBe('BAD_REQUEST');
    });

    /*
     * The defensive case that keeps the branch honest: an `errors` array with nothing renderable must NOT
     * manufacture an empty `details.fields` or a blank `message`. It falls through, so the generic path can use the
     * body's own string message.
     */
    it('declines an errors array with nothing renderable, rather than publishing an empty fields list', () => {
        expect(asValidationEnvelope({ errors: [] }, 'VALIDATION_FAILED')).toBeUndefined();
        expect(asValidationEnvelope({ errors: [null, 7] }, 'VALIDATION_FAILED')).toBeUndefined();
    });

    it.each([
        ['a body with no errors key', { message: 'x' }],
        ['a non-array errors key', { errors: 'nope' }],
        ['a string body', 'nope'],
        ['null', null],
    ])('declines %s', (_label, body) => {
        expect(asValidationEnvelope(body, 'VALIDATION_FAILED')).toBeUndefined();
    });
});

/*
 * ── THE BRANCH IDENTITY DID NOT HAVE ──
 *
 * Its absence is what made identity's readiness `503` publish `SERVICE_UNAVAILABLE` while its own OpenAPI document
 * promised `NOT_READY`. The property is: a body that already NAMES its code keeps that code, because a status-keyed
 * derivation cannot tell two failures that share a status apart — and that distinction is the entire reason the
 * envelope carries a code.
 */
describe('asExplicitEnvelope', () => {
    it('takes a body that already names its code, verbatim', () => {
        expect(asExplicitEnvelope({ code: 'NOT_READY', message: 'Database not reachable' }, 'fallback')).toEqual({
            code: 'NOT_READY',
            message: 'Database not reachable',
        });
    });

    it('keeps the code and borrows the exception message when the body carries none', () => {
        expect(asExplicitEnvelope({ code: 'ACCOUNT_SUSPENDED' }, 'Forbidden Exception')).toEqual({
            code: 'ACCOUNT_SUSPENDED',
            message: 'Forbidden Exception',
        });
    });

    it('falls back to the unspecified message when neither the body nor the exception has one', () => {
        expect(asExplicitEnvelope({ code: 'X' }, '')).toEqual({ code: 'X', message: UNSPECIFIED_MESSAGE });
    });

    it('carries an object details through', () => {
        expect(asExplicitEnvelope({ code: 'X', message: 'm', details: { limit: 10 } }, 'f')).toEqual({
            code: 'X',
            message: 'm',
            details: { limit: 10 },
        });
    });

    it.each([
        ['an array details', []],
        ['a null details', null],
        ['a scalar details', 7],
    ])('omits %s rather than publishing a non-object under details', (_label, details) => {
        expect(asExplicitEnvelope({ code: 'X', message: 'm', details }, 'f')).toEqual({ code: 'X', message: 'm' });
    });

    /*
     * ⚠️ THE ENVELOPE IS REBUILT, NOT SPREAD. A body of `{ code, message, id }` must not publish a stray top-level
     * `id`, because "extras live in `details`" is the property the one-shape contract rests on. If this ever became
     * a spread, this assertion is what fails.
     */
    it('drops a stray top-level key instead of spreading it onto the wire', () => {
        expect(asExplicitEnvelope({ code: 'X', message: 'm', id: 'leak', sql: 'SELECT 1' }, 'f')).toEqual({
            code: 'X',
            message: 'm',
        });
    });

    it.each([
        ['no code', { message: 'm' }],
        ['an empty code', { code: '', message: 'm' }],
        ['a non-string code', { code: 7, message: 'm' }],
        ['a string body', 'nope'],
        ['null', null],
    ])('declines a body with %s, so it still gets a status-derived code', (_label, body) => {
        expect(asExplicitEnvelope(body, 'f')).toBeUndefined();
    });
});

describe('describeBody', () => {
    it('reads a bare string body — the throttler 429 that used to reach the wire as JSON text', () => {
        expect(describeBody('ThrottlerException: Too Many Requests', 'f')).toEqual({
            message: 'ThrottlerException: Too Many Requests',
        });
    });

    it("reads Nest's own object body", () => {
        expect(describeBody({ statusCode: 400, message: 'bad input', error: 'Bad Request' }, 'f')).toEqual({
            message: 'bad input',
        });
    });

    /*
     * `error` is used ONLY when there is no `message`, because in Nest's own body `error` is the STATUS TEXT
     * (`'Unauthorized'`) — publishing that over the message beside it would be strictly less informative.
     */
    it('prefers message over error, and uses error only when message is absent', () => {
        expect(describeBody({ message: 'specific', error: 'Bad Request' }, 'f').message).toBe('specific');
        expect(describeBody({ statusCode: 401, error: 'Unauthorized' }, 'f').message).toBe('Unauthorized');
    });

    it("publishes Nest's array message under details.fields — the same key the zod path uses", () => {
        expect(describeBody({ message: ['a must be a string', 'a should not be empty'] }, 'f')).toEqual({
            message: 'a must be a string, a should not be empty',
            details: { fields: ['a must be a string', 'a should not be empty'] },
        });
    });

    it('lifts caller-relevant extras into details, and never the framework keys', () => {
        expect(describeBody({ statusCode: 503, message: 'unavailable', service: 'food', retryAfter: 30 }, 'f')).toEqual(
            {
                message: 'unavailable',
                details: { service: 'food', retryAfter: 30 },
            },
        );
    });

    it.each([
        ['a number', 7],
        ['an array', [1, 2]],
        ['null', null],
    ])('falls back to the exception message for %s', (_label, body) => {
        expect(describeBody(body, 'from the exception').message).toBe('from the exception');
    });

    it('falls back to the unspecified message when the exception has none either', () => {
        expect(describeBody(null, '').message).toBe(UNSPECIFIED_MESSAGE);
        expect(describeBody('', '').message).toBe(UNSPECIFIED_MESSAGE);
    });

    it('treats exactly the six framework keys as framework-owned', () => {
        expect([...FRAMEWORK_KEYS].sort()).toEqual(['code', 'details', 'error', 'errors', 'message', 'statusCode']);
    });
});

describe('codeForStatus', () => {
    it('reads the table it is given, so a service override wins over the generic vocabulary', () => {
        expect(codeForStatus(HttpStatus.NOT_FOUND, VOCABULARY.statusCode)).toBe('ROUTE_NOT_FOUND');
        expect(codeForStatus(HttpStatus.NOT_FOUND, GENERIC_STATUS_CODES)).toBe('NOT_FOUND');
    });

    it('derives a deterministic HTTP_<status> for an unlisted status, which leaks nothing', () => {
        expect(codeForStatus(418, GENERIC_STATUS_CODES)).toBe('HTTP_418');
    });

    /*
     * `423 LOCKED` and `410 GONE` are the two rows food's and identity's hand-written copies were MISSING while
     * recipe's had them. Pinned here so the shared table cannot lose them again — and 423 is asserted by number
     * because Nest's `HttpStatus` enum does not define it (WebDAV, RFC 4918).
     */
    it('includes the two rows the hand-written copies had drifted apart on', () => {
        expect(GENERIC_STATUS_CODES[423]).toBe('LOCKED');
        expect(GENERIC_STATUS_CODES[HttpStatus.GONE]).toBe('GONE');
    });
});

describe('normalizeHttpException', () => {
    it('normalizes an explicit-code body, keeping the code and the exception status', () => {
        const exception = new HttpException({ code: 'NOT_READY', message: 'Database not reachable' }, 503);

        expect(normalizeHttpException(exception, VOCABULARY)).toEqual({
            status: 503,
            body: { code: 'NOT_READY', message: 'Database not reachable' },
        });
    });

    it('normalizes a validation body into the vocabulary’s validation code plus details.fields', () => {
        const exception = new BadRequestException({
            statusCode: 400,
            message: 'Validation failed',
            errors: [{ path: ['pageSize'], message: 'Too big' }],
        });

        expect(normalizeHttpException(exception, VOCABULARY)).toEqual({
            status: 400,
            body: {
                code: 'VALIDATION_FAILED',
                message: 'pageSize: Too big',
                details: { fields: ['pageSize: Too big'] },
            },
        });
    });

    /*
     * BRANCH ORDER, asserted rather than assumed: an explicit `code` wins over a validation body, because a
     * service that raises `{ code: 'X', errors: [...] }` means the `X`. Reversing the two `??` operands is a
     * plausible refactor, and this is what stops it.
     */
    it('prefers an explicit code over a validation body when a body carries both', () => {
        const exception = new BadRequestException({
            code: 'UNKNOWN_INGREDIENT',
            message: 'no such id',
            errors: [{ path: ['a'], message: 'x' }],
        });

        expect(normalizeHttpException(exception, VOCABULARY).body.code).toBe('UNKNOWN_INGREDIENT');
    });

    it('derives the code from the status for a framework body with none of its own', () => {
        expect(normalizeHttpException(new ForbiddenException('nope'), VOCABULARY)).toEqual({
            status: 403,
            body: { code: 'FORBIDDEN', message: 'nope' },
        });
    });

    it('handles a bare-string body at an unmapped status', () => {
        expect(normalizeHttpException(new HttpException('teapot', 418), VOCABULARY)).toEqual({
            status: 418,
            body: { code: 'HTTP_418', message: 'teapot' },
        });
    });

    /*
     * NON-VACUITY over the whole module, stated as the property the extraction exists to guarantee: there is NO
     * passthrough branch. Whatever shape goes in, exactly `code` + `message` (+ optional `details`) comes out.
     */
    it.each([
        ['a string body', new HttpException('x', 400)],
        ['an object body', new HttpException({ statusCode: 400, message: 'x', error: 'Bad Request' }, 400)],
        ['an argument-less exception', new ForbiddenException()],
        ['an array body', new HttpException([1, 2] as unknown as string, 400)],
        ['a numeric body', new HttpException(7 as unknown as string, 400)],
        ['an explicit envelope', new HttpException({ code: 'X', message: 'y', details: { a: 1 } }, 409)],
    ])('emits ONLY envelope keys for %s — there is no passthrough', (_label, exception) => {
        const { body } = normalizeHttpException(exception, VOCABULARY);

        expect(Object.keys(body).sort().join(',')).toMatch(/^(code,details,message|code,message)$/u);
        expect(typeof body.code).toBe('string');
        expect(body.code.length).toBeGreaterThan(0);
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(0);
    });
});
