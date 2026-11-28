/**
 * `ServiceUnreachableError` is what the shared ALB's own 404 becomes (ADR-0003): the food service did not answer. It is
 * a `FetchUnavailableError`, so every caller that retries "nothing answered" retries it with no edit. It is not a
 * `SourceBusyError`, which means "food answered busy", and its `503` is not a `404`, so nothing that branches on
 * `status === 404` reads it as "the food is gone". It carries a status and no cause, because a response came in.
 */
import { describe, expect, it } from 'vitest';

import {
    isFetchUnavailableError,
    isNotFoundError,
    isServiceUnreachableError,
    isSourceBusyError,
    NotFoundError,
    ServiceUnreachableError,
    SourceBusyError,
} from '../index.js';

describe('ServiceUnreachableError', () => {
    it('carries status 503 and no cause, and is a FetchUnavailableError', () => {
        const error = new ServiceUnreachableError();

        expect(error).toMatchObject({ status: 503, cause: undefined, name: 'ServiceUnreachableError' });
        expect(isFetchUnavailableError(error)).toBe(true);
    });

    it('is not a busy answer and not a not-found, in either direction', () => {
        const error = new ServiceUnreachableError();

        expect(isServiceUnreachableError(error)).toBe(true);
        expect(isSourceBusyError(error)).toBe(false);
        expect(isNotFoundError(error)).toBe(false);
        expect(isServiceUnreachableError(new SourceBusyError())).toBe(false);
        expect(isServiceUnreachableError(new NotFoundError('food_1'))).toBe(false);
    });
});
