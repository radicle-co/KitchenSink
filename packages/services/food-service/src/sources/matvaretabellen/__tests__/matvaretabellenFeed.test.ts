/**
 * The Matvaretabellen publisher feed (plan U28, KTD-26): one GET of `/api/en/foods.json`, made through the source's
 * rate-limited `fetch` so it is charged against Matvaretabellen's own daily window (ceiling ⌊0.9 × 24⌋ = 21), under
 * an explicit deadline that covers the 13.7 MB body. A busy source pauses the sync with `SourceBusyError`, and an
 * answer that is not 2xx is the source's own failure.
 */
import { describe, expect, it } from 'vitest';

import { isSourceApiError, isSourceBusyError } from '../../foodSource.errors.js';
import { isMirrorFeedFormatError } from '../../mirror/mirrorFeed.errors.js';
import { RateLimitedTransport, type Admission, type FetchFn } from '../../transport/RateLimitedTransport.js';
import { matvaretabellenDocument, makeMatvaretabellenFood } from '../__fixtures__/matvaretabellenFood.fixtures.js';
import { matvaretabellenFeed } from '../matvaretabellenFeed.js';

/** A rate-limited `fetch` for Matvaretabellen over fake ports, and what the source saw. */
function makeFetch(upstream: FetchFn, admission: Admission = { admitted: true }) {
    const requests: { url: string; signal: AbortSignal | null | undefined }[] = [];
    const transport = new RateLimitedTransport({
        admission: { admit: async () => admission },
        blocks: { record: async () => undefined },
        metrics: { recordSourceRateLimit: () => undefined },
        upstream: async (input, init) => {
            requests.push({ url: input instanceof Request ? input.url : input.toString(), signal: init?.signal });

            return upstream(input, init);
        },
    });

    return { fetch: transport.fetchFor('matvaretabellen', 'worker'), requests };
}

describe('matvaretabellenFeed', () => {
    it("GETs the English foods list from the register's base URL, under a deadline, and reads it as a pull", async () => {
        const beans = makeMatvaretabellenFood();
        const { fetch, requests } = makeFetch(async () => new Response(matvaretabellenDocument([beans])));

        const pull = await matvaretabellenFeed(fetch).pull();

        expect(pull.items.map((item) => item.externalKey)).toEqual(['06.178']);
        expect(requests.map((request) => request.url)).toEqual(['https://www.matvaretabellen.no/api/en/foods.json']);
        expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('names its source', () => {
        const { fetch } = makeFetch(async () => new Response('{}'));

        expect(matvaretabellenFeed(fetch).source).toBe('matvaretabellen');
    });

    it('pauses with SourceBusyError, and never calls the publisher, when the source is busy', async () => {
        let called = false;
        const { fetch } = makeFetch(
            async () => {
                called = true;

                return new Response('{}');
            },
            { admitted: false, reason: 'ceiling', retryAt: '2026-10-02T00:00:00.000Z' },
        );

        await expect(matvaretabellenFeed(fetch).pull()).rejects.toSatisfy(isSourceBusyError);
        expect(called).toBe(false);
    });

    it.each([404, 429, 500, 503])("fails a %i as the source's own answer, carrying its status", async (status) => {
        const { fetch } = makeFetch(async () => new Response('nope', { status }));

        const thrown = await matvaretabellenFeed(fetch)
            .pull()
            .catch((error: unknown) => error);

        expect(isSourceApiError(thrown)).toBe(true);
        expect(isSourceApiError(thrown) && { source: thrown.source, status: thrown.statusCode }).toEqual({
            source: 'matvaretabellen',
            status,
        });
    });

    it('refuses a body that is not the foods document', async () => {
        const { fetch } = makeFetch(async () => new Response('<html>maintenance</html>'));

        await expect(matvaretabellenFeed(fetch).pull()).rejects.toSatisfy(isMirrorFeedFormatError);
    });

    it('gives up at its deadline rather than hanging on a stalled publisher', async () => {
        const { fetch } = makeFetch(
            async (_, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(init.signal?.reason);
                    });
                }),
        );

        await expect(matvaretabellenFeed(fetch, { timeoutMs: 20 }).pull()).rejects.toMatchObject({
            name: 'TimeoutError',
        });
    });
});
