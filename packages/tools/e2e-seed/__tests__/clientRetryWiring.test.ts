/**
 * `clientWithToken` (and so `clientFor`) must ride the retrying transport: a 502 on the first GET of `reset`'s
 * `readWorld` is what stopped a shard. Drives the REAL recipe client over a stubbed global `fetch`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientWithToken } from '../src/client.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('clientWithToken transport', () => {
    it('survives one gateway 502 on a read', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const fetchStub = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [], hasMore: false, total: 0, page: 1, pageSize: 20 }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        vi.stubGlobal('fetch', fetchStub);

        const pending = clientWithToken('https://recipe.test', () => Promise.resolve('t')).listCollections();
        await vi.runAllTimersAsync();

        await expect(pending).resolves.toBeDefined();
        // The client also probes contract skew through the same fetch, so count only the read itself.
        const reads = fetchStub.mock.calls.filter(([input]) =>
            String(input instanceof Request ? input.url : input).includes('/api/v1/collections'),
        );

        expect(reads).toHaveLength(2);
    });
});
