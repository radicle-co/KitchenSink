/**
 * Unit suite for {@link LiveFoodSearchService} — the ON-DEMAND source search behind the picker's
 * "Search USDA for '…'" affordance (plan U29; ingredient-search plan §2 Stage 3).
 *
 * This service exists at all because of an arithmetic fact: the documented USDA limit is 1,000
 * requests/hour PER IP and FR-019 reserves only the top 10% of it for user-facing work, so at 50
 * concurrent cooks a "perfect" one-call-per-settled-query autocomplete would want ~3x the ENTIRE key.
 * The only affordable shape is a deliberate, occasional action a cook chooses — and the calls it makes
 * must come out of the reserved interactive lane, never the drain's budget.
 *
 * ⛔ That last sentence is the property most of these cases are about, and it is asserted through a
 * limiter double that records the LANE it was charged on rather than a stub returning `{allowed:true}`:
 * a mutant that charges `'worker'` would satisfy a stub and fail here.
 *
 * @implements FR-019 FR-020 FR-026 FR-IDN-2 FR-010a
 */
import { describe, expect, it, vi } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import type { FoodSourcesDao } from '../dao/index.js';
import type { SourceCallChannel } from '../dao/index.js';
import { SourceApiError } from '../../sources/foodSource.errors.js';
import type { FoodSourceAdapter, SourceCandidate } from '../../sources/foodSourceAdapter.js';
import type { RollingWindowLimiter } from '../../sources/RollingWindowLimiter.js';
import type { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { isFetchUnavailableError, isSourceUnavailableError } from '../foods.errors.js';
import { LIVE_SEARCH_RESULT_LIMIT, LiveFoodSearchService } from '../liveSearch.service.js';

/** A candidate as the adapter boundary yields it — `externalKey` is the fdcId, and must never escape. */
function candidate(name: string, externalKey: string): SourceCandidate {
    return { source: 'usda', externalKey, name };
}

/** Records every charge so a case can assert WHICH lane paid, not merely that something was charged. */
function limiterDouble(options?: { readonly allow?: boolean }): RollingWindowLimiter & {
    readonly charges: SourceCallChannel[];
    readonly windowFulls: string[];
} {
    const charges: SourceCallChannel[] = [];
    const windowFulls: string[] = [];
    const allow = options?.allow ?? true;

    return {
        charges,
        windowFulls,
        tryRecord: (_source: string, channel: SourceCallChannel) => {
            if (allow) {
                charges.push(channel);
            }

            return Promise.resolve({ allowed: allow, windowCount: charges.length });
        },
        markWindowFull: (source: string) => {
            windowFulls.push(source);
        },
    } as unknown as RollingWindowLimiter & { readonly charges: SourceCallChannel[]; readonly windowFulls: string[] };
}

/** A registry over one adapter whose `searchByName` behaves however the case needs. */
function registryDouble(searchByName: FoodSourceAdapter['searchByName']): SourceAdapterRegistry {
    const adapter = { source: 'usda', searchByName } as unknown as FoodSourceAdapter;

    return { adapters: () => [adapter] } as unknown as SourceAdapterRegistry;
}

/** A crosswalk reporting exactly the `externalKey -> foodId` pairs a case seeds. */
function crosswalkDouble(mapping: Readonly<Record<string, string>> = {}): FoodSourcesDao {
    return {
        findFoodIdsByExternalKeys: (_source: string, keys: readonly string[]) =>
            Promise.resolve(new Map(keys.filter((key) => key in mapping).map((key) => [key, mapping[key] as string]))),
    } as unknown as FoodSourcesDao;
}

describe('LiveFoodSearchService', () => {
    describe('the reserved interactive lane (F-W1, FR-019)', () => {
        it('charges the INTERACTIVE lane — never the background drain’s budget', async () => {
            const limiter = limiterDouble();
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('Egg, whole, raw', '748967')])),
                limiter,
                crosswalkDouble(),
            );

            await service.search('egg');

            // ⛔ The mutation this whole unit exists to catch: `'worker'` here caps the cook's search at the
            // 90% pause threshold instead of the hard cap, so it is refused with a tenth of the key unspent.
            expect(limiter.charges).toEqual(['interactive']);
        });

        it('charges EXACTLY ONE call per search, whatever the source returns', async () => {
            const limiter = limiterDouble();
            const service = new LiveFoodSearchService(
                registryDouble(() =>
                    Promise.resolve([candidate('Egg, white, raw', '1'), candidate('Egg, yolk, raw', '2')]),
                ),
                limiter,
                crosswalkDouble(),
            );

            await service.search('egg');

            expect(limiter.charges).toHaveLength(1);
        });

        it('refuses with a retryable BUSY signal when the lane is exhausted, and makes no source call', async () => {
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(
                registryDouble(searchByName),
                limiterDouble({ allow: false }),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isFetchUnavailableError);
            // The whole point of charging BEFORE the call: a denied charge must not spend the source.
            expect(searchByName).not.toHaveBeenCalled();
        });
    });

    describe('the three outcomes a cook must be able to tell apart', () => {
        it('returns the source’s hits on success', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('Egg, whole, raw', '748967')])),
                limiterDouble(),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).resolves.toEqual({
                results: [{ name: 'Egg, whole, raw' }],
            });
        });

        it('returns an EMPTY result set — "the source has nothing" is a success, not a failure', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([])),
                limiterDouble(),
                crosswalkDouble(),
            );

            // ⛔ Distinct from every rejection below. A cook who sees "USDA has nothing" should stop looking;
            // one who sees "USDA did not answer" should try again. Collapsing them strands the first cook.
            await expect(service.search('nosuchfood')).resolves.toEqual({ results: [] });
        });

        it('rejects as UNAVAILABLE when the source fails in transport (statusCode 0)', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 0, 'timeout'))),
                limiterDouble(),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });

        it('rejects as UNAVAILABLE on a source 5xx', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 503, 'upstream down'))),
                limiterDouble(),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });

        it('rejects as BUSY on a source 429, and trips the failsafe so the next caller backs off too', async () => {
            const limiter = limiterDouble();
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 429, 'rate limited'))),
                limiter,
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isFetchUnavailableError);
            // Without this the window keeps admitting calls the source is already refusing (FR-026).
            expect(limiter.windowFulls).toEqual(['usda']);
        });

        it('rejects as UNAVAILABLE when the adapter throws something unclassified', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new TypeError('undefined is not a function'))),
                limiterDouble(),
                crosswalkDouble(),
            );

            // A bug in the adapter must still reach the cook as "the source did not answer", never as an
            // unhandled 500 whose body says nothing they can act on.
            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });
    });

    describe('the identity boundary (FR-IDN-2) and the crosswalk', () => {
        it('never puts the source-native key on the wire', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('Egg, whole, raw', '748967')])),
                limiterDouble(),
                crosswalkDouble(),
            );

            expect(JSON.stringify(await service.search('egg'))).not.toContain('748967');
        });

        it('carries the INTERNAL id for a hit already admitted to our catalog', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() =>
                    Promise.resolve([candidate('Egg, whole, raw', '748967'), candidate('Egg, white, raw', '999')]),
                ),
                limiterDouble(),
                crosswalkDouble({ '748967': 'food_01ABC' }),
            );

            // An already-admitted hit can be picked with ZERO further source calls; an unknown one cannot,
            // and saying which is which is the difference between a free pick and another quota charge.
            await expect(service.search('egg')).resolves.toEqual({
                results: [{ name: 'Egg, whole, raw', id: 'food_01ABC' }, { name: 'Egg, white, raw' }],
            });
        });

        it('crosswalks in ONE batch query rather than once per hit', async () => {
            const findFoodIdsByExternalKeys = vi.fn(() => Promise.resolve(new Map<string, string>()));
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('a', '1'), candidate('b', '2'), candidate('c', '3')])),
                limiterDouble(),
                { findFoodIdsByExternalKeys } as unknown as FoodSourcesDao,
            );

            await service.search('egg');

            expect(findFoodIdsByExternalKeys).toHaveBeenCalledTimes(1);
            expect(findFoodIdsByExternalKeys).toHaveBeenCalledWith('usda', ['1', '2', '3']);
        });

        it('skips the crosswalk entirely when the source returned nothing', async () => {
            const findFoodIdsByExternalKeys = vi.fn(() => Promise.resolve(new Map<string, string>()));
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([])),
                limiterDouble(),
                {
                    findFoodIdsByExternalKeys,
                } as unknown as FoodSourcesDao,
            );

            await service.search('egg');

            expect(findFoodIdsByExternalKeys).not.toHaveBeenCalled();
        });
    });

    describe('bounds', () => {
        it(`truncates to ${LIVE_SEARCH_RESULT_LIMIT} results, so one source cannot flood the picker`, async () => {
            const hits = Array.from({ length: LIVE_SEARCH_RESULT_LIMIT + 7 }, (_unused, index) =>
                candidate(`food ${index}`, String(index)),
            );
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve(hits)),
                limiterDouble(),
                crosswalkDouble(),
            );

            const response = await service.search('egg');

            expect(response.results).toHaveLength(LIVE_SEARCH_RESULT_LIMIT);
            // Truncation happens BEFORE the crosswalk, so the discarded tail costs no database work either.
            expect(response.results.at(-1)?.name).toBe(`food ${LIVE_SEARCH_RESULT_LIMIT - 1}`);
        });

        it(`refuses a query below the ${MIN_SEARCH_QUERY_LENGTH}-character minimum WITHOUT spending the lane`, async () => {
            const limiter = limiterDouble();
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(registryDouble(searchByName), limiter, crosswalkDouble());

            // 003-FR-010a. ⛔ Unlike the LOCAL `/foods/search`, which short-circuits to an empty page, this
            // one REJECTS: an empty page here is indistinguishable from "the source has nothing", and the
            // whole surface turns on that distinction. The client gates first; this is the authority.
            await expect(service.search('eg')).rejects.toThrow();
            expect(limiter.charges).toEqual([]);
            expect(searchByName).not.toHaveBeenCalled();
        });

        it('trims the query before measuring it against the minimum', async () => {
            const limiter = limiterDouble();
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([])),
                limiter,
                crosswalkDouble(),
            );

            await expect(service.search('  eg  ')).rejects.toThrow();
            expect(limiter.charges).toEqual([]);
        });

        it('passes the TRIMMED query to the source, never the raw box text', async () => {
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(registryDouble(searchByName), limiterDouble(), crosswalkDouble());

            await service.search('  egg  ');

            expect(searchByName).toHaveBeenCalledWith('egg');
        });
    });
});
