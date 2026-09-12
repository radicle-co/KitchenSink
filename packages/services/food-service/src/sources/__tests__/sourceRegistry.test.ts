/**
 * Unit tests for {@link createSourceRegistry}, the ONE composition of the wired source adapters (FR-ADP-1, ADR-0053
 * §3). It is the only place a source client is built, so it is where "every request goes through the transport" is
 * either true or false: these drive the real USDA adapter over the real client over the real transport, with
 * admission, the block ledger, the quota sink and USDA itself as doubles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../config/env.schema.js';
import { isSourceAccountingError, isSourceBusyError } from '../foodSource.errors.js';
import { createSourceRegistry } from '../sourceRegistry.js';
import type { Admission, FetchFn, SourceBlock, SourceCallChannel } from '../transport/transportPorts.js';

/** The `USDA_API_BASE_URL` default the boot-time schema applies — never restated here as a literal. */
const SCHEMA_DEFAULT_BASE_URL = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
}).USDA_API_BASE_URL;

/** An empty USDA search envelope with the given status and headers. */
function answer(status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ foods: [], totalHits: 0 }), { status, headers });
}

/** The registry over doubles, and what each double saw. */
function compose(options: { admission?: Admission; upstream?: () => Response; lane?: SourceCallChannel } = {}) {
    const admitted: string[] = [];
    const blocks: SourceBlock[] = [];
    const quotas: unknown[] = [];
    const urls: string[] = [];

    const upstream: FetchFn = async (input) => {
        urls.push(input instanceof Request ? input.url : String(input));

        return (options.upstream ?? (() => answer(200)))();
    };

    const registry = createSourceRegistry({
        lane: options.lane ?? 'worker',
        admission: {
            admit: async (source, lane) => {
                admitted.push(`${source}:${lane}`);

                return options.admission ?? { admitted: true };
            },
        },
        blocks: { record: async (block) => void blocks.push(block) },
        metrics: { recordSourceRateLimit: (_, reading) => void quotas.push(reading) },
        upstream,
    });

    return { registry, admitted, blocks, quotas, urls };
}

describe('createSourceRegistry', () => {
    beforeEach(() => {
        vi.stubEnv('USDA_API_KEY', 'test-usda-key');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('registers exactly the wired usda adapter', () => {
        const { registry } = compose();

        expect(registry.adapters().map((adapter) => adapter.source)).toEqual(['usda']);
    });

    it.each(['interactive', 'worker'] as const)(
        'admits every USDA request on the %s lane before sending it',
        async (lane) => {
            const { registry, admitted, urls } = compose({ lane });

            await registry.adapterFor('usda').searchByName('broccoli');

            expect(admitted).toEqual([`usda:${lane}`]);
            expect(urls).toHaveLength(1);
        },
    );

    it('surfaces a refused admission as SourceBusyError and never calls USDA', async () => {
        const { registry, urls } = compose({
            admission: { admitted: false, reason: 'ceiling', retryAt: '2026-10-01T07:00:00.000Z' },
        });

        const thrown = await registry
            .adapterFor('usda')
            .searchByName('broccoli')
            .catch((error: unknown) => error);

        expect(isSourceBusyError(thrown) && thrown.reason).toBe('ceiling');
        expect(urls).toEqual([]);
    });

    it('writes the block a 429 earns before the client reads the status', async () => {
        const { registry, blocks } = compose({ upstream: () => answer(429) });

        await registry
            .adapterFor('usda')
            .searchByName('broccoli')
            .catch(() => undefined);

        expect(blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 3600 }]);
    });

    it('reports USDA’s quota reading once per response, through the transport alone', async () => {
        const { registry, quotas } = compose({
            upstream: () => answer(200, { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '873' }),
        });

        await registry.adapterFor('usda').searchByName('broccoli');

        expect(quotas).toEqual([{ limit: 1000, remaining: 873 }]);
    });

    it('withholds a 429 whose block could not be written, as our own accounting failure', async () => {
        const registry = createSourceRegistry({
            lane: 'worker',
            admission: { admit: async () => ({ admitted: true }) },
            blocks: {
                record: async () => {
                    throw new Error('database down');
                },
            },
            metrics: { recordSourceRateLimit: () => undefined },
            upstream: async () => answer(429),
        });

        const thrown = await registry
            .adapterFor('usda')
            .searchByName('broccoli')
            .catch((error: unknown) => error);

        expect(isSourceAccountingError(thrown) && thrown.step).toBe('record');
    });

    it('targets the configured USDA_API_BASE_URL', async () => {
        vi.stubEnv('USDA_API_BASE_URL', 'https://usda-stub.internal/fdc/v1');
        const { registry, urls } = compose();

        await registry.adapterFor('usda').searchByName('broccoli');

        expect(urls[0]?.startsWith('https://usda-stub.internal/fdc/v1/foods/search')).toBe(true);
    });

    it('falls back to the schema default base URL when unset', async () => {
        vi.stubEnv('USDA_API_BASE_URL', undefined);
        const { registry, urls } = compose();

        await registry.adapterFor('usda').searchByName('broccoli');

        expect(urls[0]?.startsWith(`${SCHEMA_DEFAULT_BASE_URL}/foods/search`)).toBe(true);
    });

    it('fails loudly and namedly when USDA_API_KEY is absent — never an empty-key client', () => {
        vi.stubEnv('USDA_API_KEY', undefined);

        expect(() => compose()).toThrow(/USDA_API_KEY/u);
    });

    it.each(['', 'not-a-url', 'usda.example.com'])(
        'fails at composition on the malformed base URL %o, naming the variable',
        (value) => {
            vi.stubEnv('USDA_API_BASE_URL', value);

            expect(() => compose()).toThrow(/USDA_API_BASE_URL/u);
        },
    );
});
