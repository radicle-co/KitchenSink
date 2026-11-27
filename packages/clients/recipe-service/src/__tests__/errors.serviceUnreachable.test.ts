/**
 * `ServiceUnreachableError` is what the shared ALB's own 404 becomes (ADR-0003): the recipe service did not answer.
 * It is NOT `SourceUnavailableError`, which means the food service did not answer, because `status` and `code` are
 * what logs and alerts read, and a routing outage must not be blamed on food. Its `503` is also not a `404`, so
 * nothing that branches on `status === 404` can read it as "the item is gone".
 */
import { describe, expect, it } from 'vitest';

import {
    isNotFoundError,
    isRecipeServiceClientError,
    isServiceUnreachableError,
    isSourceUnavailableError,
    ServiceUnreachableError,
    SourceUnavailableError,
} from '../index.js';

describe('ServiceUnreachableError', () => {
    it('carries status 503 and the code SERVICE_UNREACHABLE', () => {
        const error = new ServiceUnreachableError();

        expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNREACHABLE', name: 'ServiceUnreachableError' });
        expect(isRecipeServiceClientError(error)).toBe(true);
    });

    it('is not a food outage and not a not-found, in either direction', () => {
        const error = new ServiceUnreachableError();

        expect(isServiceUnreachableError(error)).toBe(true);
        expect(isSourceUnavailableError(error)).toBe(false);
        expect(isNotFoundError(error)).toBe(false);
        expect(isServiceUnreachableError(new SourceUnavailableError())).toBe(false);
    });

    it('keeps a message it is given', () => {
        expect(new ServiceUnreachableError('gone fishing').message).toBe('gone fishing');
    });
});
