/**
 * Unit tests for {@link createUsdaSourceRegistry} — the ONE composition of the wired USDA source adapter.
 *
 * Three composition roots built this registry independently (`worker/main.ts`, `worker/change-refresh/main.ts`,
 * `foods/foods.module.ts`), and all three drifted:
 *
 * - each read `USDA_API_KEY` off `process.env` itself, with THREE different failure behaviours — two
 *   bespoke `throw new Error('USDA_API_KEY is required to run …')` messages and, in the Nest factory,
 *   `?? ''`, which builds a client that would call USDA with an empty key;
 * - none passed `USDA_API_BASE_URL`, so that documented, boot-validated setting had **no consumer
 *   anywhere** — pointing a preview at a stub base URL silently kept hitting the real USDA quota.
 *
 * Extracted for the same reason `worker/concurrency.ts` was: both Fargate entrypoints run
 * `void bootstrap()` on import, so nothing composed there can be tested without starting a worker.
 *
 * @implements FR-ADP-1
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../../config/env.schema.js';
import { FOOD_METRIC, FoodMetrics, type EmfPayload } from '../../../observability/emfMetrics.js';
import { createUsdaSourceRegistry } from '../usdaRegistry.js';

/** The `USDA_API_BASE_URL` default the boot-time schema applies — never restated here as a literal. */
const SCHEMA_DEFAULT_BASE_URL = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
}).USDA_API_BASE_URL;

/** Capture the URL the adapter actually requests, answering with an empty USDA search envelope. */
function captureRequestUrl(): { urls: string[] } {
    const urls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        urls.push(String(input));

        return Promise.resolve(new Response(JSON.stringify({ foods: [], totalHits: 0 }), { status: 200 }));
    });

    return { urls };
}

describe('createUsdaSourceRegistry', () => {
    beforeEach(() => {
        vi.stubEnv('USDA_API_KEY', 'test-usda-key');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('registers exactly the wired usda adapter', () => {
        const registry = createUsdaSourceRegistry();

        expect(registry.has('usda')).toBe(true);
        expect(registry.adapterFor('usda').source).toBe('usda');
    });

    it('targets the CONFIGURED USDA_API_BASE_URL — the setting finally reaches a request', async () => {
        vi.stubEnv('USDA_API_BASE_URL', 'https://usda-stub.internal/fdc/v1');
        const { urls } = captureRequestUrl();

        await createUsdaSourceRegistry().adapterFor('usda').searchByName('broccoli');

        expect(urls[0].startsWith('https://usda-stub.internal/fdc/v1/foods/search')).toBe(true);
        expect(urls[0]).not.toContain('api.nal.usda.gov');
    });

    it('falls back to the schema default base URL when unset', async () => {
        vi.stubEnv('USDA_API_BASE_URL', undefined);
        const { urls } = captureRequestUrl();

        await createUsdaSourceRegistry().adapterFor('usda').searchByName('broccoli');

        expect(urls[0].startsWith(`${SCHEMA_DEFAULT_BASE_URL}/foods/search`)).toBe(true);
    });

    it('fails loudly and namedly when USDA_API_KEY is absent — never an empty-key client', () => {
        vi.stubEnv('USDA_API_KEY', undefined);

        expect(() => createUsdaSourceRegistry()).toThrow(/USDA_API_KEY/);
    });

    /**
     * U38 — the registry is where the client's rate-limit observer is wired, because it is the ONE
     * composition every process shares. The reading has to LAND somewhere observable: parsing
     * `X-RateLimit-Remaining` and dropping it settles nothing, and settling the per-IP-versus-per-key
     * question empirically is the whole reason for reading it.
     */
    describe('X-RateLimit reading (U38)', () => {
        /** Answer with an empty USDA search envelope carrying the supplied headers. */
        function respondWithHeaders(headers: Record<string, string>): void {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(JSON.stringify({ foods: [], totalHits: 0 }), { status: 200, headers }),
            );
        }

        it('emits the quota USDA reported as an EMF line under the usda source dimension', async () => {
            respondWithHeaders({ 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '873' });
            const sink = vi.fn();

            await createUsdaSourceRegistry(new FoodMetrics(sink)).adapterFor('usda').searchByName('broccoli');

            expect(sink).toHaveBeenCalledTimes(1);

            const parsed = JSON.parse(sink.mock.calls[0]![0] as string) as EmfPayload;

            expect(parsed['source']).toBe('usda');
            expect(parsed[FOOD_METRIC.sourceRateLimitRemaining]).toBe(873);
            expect(parsed[FOOD_METRIC.sourceRateLimitLimit]).toBe(1000);
        });

        it('emits nothing, and still resolves, when USDA reported no rate-limit headers', async () => {
            respondWithHeaders({ 'content-type': 'application/json' });
            const sink = vi.fn();

            const result = await createUsdaSourceRegistry(new FoodMetrics(sink))
                .adapterFor('usda')
                .searchByName('broccoli');

            expect(result).toEqual([]);
            expect(sink).not.toHaveBeenCalled();
        });
    });

    it.each(['', 'not-a-url', 'usda.example.com'])(
        'fails at composition on the malformed base URL %o, naming the variable',
        (value) => {
            vi.stubEnv('USDA_API_BASE_URL', value);

            expect(() => createUsdaSourceRegistry()).toThrow(/USDA_API_BASE_URL/);
        },
    );
});
