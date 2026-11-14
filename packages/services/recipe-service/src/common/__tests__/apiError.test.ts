/**
 * `apiErrorCodeOf` — the ONE reader of the code an {@link apiError} body carries, beside the one writer of it.
 *
 * Each row is a mutation target: reading `code` off a non-exception, or off a string body, must answer `undefined` rather
 * than throw or invent a code.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { apiError, apiErrorCodeOf } from '../apiError.js';

describe('apiErrorCodeOf', () => {
    it('reads the code apiError wrote, so a caller can branch on it', () => {
        expect(apiErrorCodeOf(apiError('SOURCE_UNAVAILABLE', 'food is down'))).toBe('SOURCE_UNAVAILABLE');
    });

    it('reads the code of any HttpException whose body carries one', () => {
        expect(apiErrorCodeOf(new HttpException({ code: 'X', message: 'm' }, HttpStatus.BAD_GATEWAY))).toBe('X');
    });

    it.each([
        ['an exception whose body is a string', new HttpException('plain', HttpStatus.BAD_REQUEST)],
        ['an exception whose body has no code', new HttpException({ message: 'm' }, HttpStatus.BAD_REQUEST)],
        ['an error that is not an HttpException', new Error('boom')],
        ['a thrown non-error', 'boom'],
    ])('is undefined for %s', (_name, error) => {
        expect(apiErrorCodeOf(error)).toBeUndefined();
    });
});
