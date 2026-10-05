/**
 * The function's entry point flushes Sentry before every invocation returns. An error line handed to Sentry is
 * buffered and sent on a timer, and Lambda may freeze the container the moment the handler returns, so without the
 * flush the line would be lost, and it was written nowhere else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const observability = vi.hoisted(() => ({
    initObservability: vi.fn(() => false),
    reportErrorLine: vi.fn(() => false),
    flushObservability: vi.fn(() => Promise.resolve()),
}));

vi.mock('../observability/observability.js', () => observability);

import { makeSearchEvent } from '../search/__fixtures__/searchEvent.js';
import { handler } from '../handler.js';

beforeEach(() => {
    observability.flushObservability.mockClear();
});

describe('handler', () => {
    it('flushes Sentry once per invocation, after the answer is built', async () => {
        const response = await handler(makeSearchEvent({ query: { admit: '0' } }));

        expect(response.statusCode).toBe(200);
        expect(observability.flushObservability).toHaveBeenCalledTimes(1);
    });

    it('flushes for a request it refuses as well', async () => {
        await handler(makeSearchEvent({ query: { q: 'EGG' } }));

        expect(observability.flushObservability).toHaveBeenCalledTimes(1);
    });
});
