/**
 * This client's half of the app's retry policy (`@commise/query`'s `RETRY_VETOES`): given a thrown value, is sending the
 * same request again worth anything? It can only say no. It decides on the error's TYPE, and it abstains (says yes) on a
 * value it does not own, so the app can fold every client's rule with AND.
 */
import { describe, expect, it } from 'vitest';

import {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClientError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    RateLimitedError,
    RequesterLimitReachedError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    UnexpectedResponseError,
} from '../errors.js';
import { shouldRetryFoodServiceFailure } from '../retryPolicy.js';

describe('shouldRetryFoodServiceFailure — what repeating cannot fix', () => {
    it.each<[string, unknown]>([
        ['a request the client refused to send', new InvalidRequestError('searchCatalog', new Error('empty'))],
        ['a 429 without a published code', new RateLimitedError(30)],
        ['the cook’s own limit', new RequesterLimitReachedError(30)],
        ['the search limit', new SearchRateLimitedError(30)],
        ['a malformed request', new BadRequestError()],
        ['a food that is not there', new NotFoundError('food_1')],
        ['a food the caller may not read', new ForbiddenError()],
        ['a food not awaiting a pick', new ConflictError()],
        ['a pick outside the food’s set', new CandidateMismatchError('food_1')],
        ['an unmapped 4xx', new UnexpectedResponseError(404)],
        ['a base error with a 4xx', new FoodServiceClientError('unprocessable', 422)],
    ])('refuses %s', (_case, error) => {
        expect(shouldRetryFoodServiceFailure(error)).toBe(false);
    });
});

describe('shouldRetryFoodServiceFailure — what may answer next time', () => {
    it.each<[string, unknown]>([
        ['a transport failure', new FetchUnavailableError(undefined, 'failed', new TypeError('fetch failed'))],
        ['food answering busy', new SourceBusyError(5)],
        // The token is minted again for each attempt, and on mobile the first can be empty while Clerk loads.
        ['a refused token', new UnauthorizedError()],
        ['an unmapped 502', new UnexpectedResponseError(502)],
        ['an unmapped 5xx', new UnexpectedResponseError(500)],
        ['a request timeout (408)', new UnexpectedResponseError(408)],
        ['a base error with no status', new FoodServiceClientError('no status')],
    ])('allows %s', (_case, error) => {
        expect(shouldRetryFoodServiceFailure(error)).toBe(true);
    });
});

describe('shouldRetryFoodServiceFailure — it abstains on what it does not own', () => {
    it.each<[string, unknown]>([
        ['a plain Error', new Error('boom')],
        ['a thrown string', 'boom'],
        ['null', null],
        ['undefined', undefined],
        // Dispatch is on the type: a foreign value whose status looks terminal is not this client's to judge.
        ['an object with a 404-looking status', { status: 404 }],
    ])('allows %s', (_case, error) => {
        expect(shouldRetryFoodServiceFailure(error)).toBe(true);
    });
});
