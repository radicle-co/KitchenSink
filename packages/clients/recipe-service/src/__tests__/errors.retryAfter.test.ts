/**
 * `retryAfterSeconds` on a client error: the wait a response's `Retry-After` header asked for. It is passed to the
 * constructor, so it is fixed when the error is built.
 */
import { describe, expect, it } from 'vitest';

import { RecipeServiceClientError, UnexpectedResponseError } from '../errors.js';

describe('retryAfterSeconds', () => {
    it('is carried by an UnexpectedResponseError built with it', () => {
        expect(new UnexpectedResponseError(429, 'slow', 'TOO_MANY_REQUESTS', 60).retryAfterSeconds).toBe(60);
    });

    it('is absent when none was given', () => {
        expect(new UnexpectedResponseError(429).retryAfterSeconds).toBeUndefined();
        expect(new RecipeServiceClientError('x', 500).retryAfterSeconds).toBeUndefined();
    });
});
