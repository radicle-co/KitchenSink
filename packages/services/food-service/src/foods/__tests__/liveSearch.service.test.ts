/**
 * Unit suite for {@link LiveFoodSearchService} — the ON-DEMAND source search behind the picker's
 * "Search USDA for '…'" affordance (plan U29; ingredient-search plan §2 Stage 3).
 *
 * This service exists at all because of an arithmetic fact: USDA counts 1,000 requests/hour per API key,
 * shared by every caller, so at 50 concurrent cooks a "perfect" one-call-per-settled-query autocomplete
 * would want ~3x the ENTIRE key.
 * The only affordable shape is a deliberate, occasional action a cook chooses.
 *
 * Admission is the registry's transport's job (ADR-0053 §3), and which lane the API's registry charges is pinned by
 * `src/sources/__tests__/sourceRegistry.test.ts`. What this service owns is how a refusal reads to the cook: these
 * cases drive the adapter double to throw exactly what the transport throws.
 *
 * @implements FR-019 FR-020 FR-026 FR-IDN-2 FR-010a
 */
import { describe, expect, it, vi } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import type { CatalogOwner, CatalogOwnerReader } from '../catalogOwnerReader.service.js';
import { SourceAccountingError, SourceApiError, SourceBusyError } from '../../sources/foodSource.errors.js';
import type { FoodSourceAdapter, SourceCandidate } from '../../sources/foodSourceAdapter.js';
import type { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { isFetchUnavailableError, isSourceUnavailableError } from '../foods.errors.js';
import { LIVE_SEARCH_RESULT_LIMIT, LiveFoodSearchService } from '../liveSearch.service.js';

/** A candidate as the adapter boundary yields it — `externalKey` is the fdcId, and must never escape. */
function candidate(name: string, externalKey: string): SourceCandidate {
    return { source: 'usda', externalKey, name };
}

/** A registry over one adapter whose `searchByName` behaves however the case needs. */
function registryDouble(searchByName: FoodSourceAdapter['searchByName']): SourceAdapterRegistry {
    const adapter = { source: 'usda', searchByName } as unknown as FoodSourceAdapter;

    return { adapters: () => [adapter] } as unknown as SourceAdapterRegistry;
}

/** A crosswalk reporting exactly the `externalKey -> foodId` pairs a case seeds. */
function crosswalkDouble(mapping: Readonly<Record<string, string>> = {}): CatalogOwnerReader {
    // Curated U8 S4: live search reads through the owner reader. A mapped key's owner is a catalog ROOT named
    // `root of <id>`, so a test can tell the root's name (R19) from the source's description.
    return {
        ownersOfKeys: (_source: string, keys: readonly string[]) =>
            Promise.resolve(
                new Map(
                    keys.flatMap((key): [string, CatalogOwner][] => {
                        const id = mapping[key];

                        return id === undefined
                            ? []
                            : [
                                  [
                                      key,
                                      {
                                          kind: 'root',
                                          id,
                                          rootId: id,
                                          rootName: `root of ${id}`,
                                          seedOwned: true,
                                          parts: [],
                                      },
                                  ],
                              ];
                    }),
                ),
            ),
    } as unknown as CatalogOwnerReader;
}

describe('LiveFoodSearchService', () => {
    describe('a refusal before the source is asked (ADR-0053 §4)', () => {
        it.each(['ceiling', 'contended'] as const)(
            'reports a %s refusal as BUSY: a retryable 503, never "the source did not answer"',
            async (reason) => {
                const service = new LiveFoodSearchService(
                    registryDouble(() =>
                        Promise.reject(new SourceBusyError('usda', reason, '2026-10-01T07:00:00.000Z')),
                    ),
                    crosswalkDouble(),
                );

                await expect(service.search('egg')).rejects.toSatisfy(isFetchUnavailableError);
            },
        );

        it('reports a blocked source as skipped: still a retryable 503, because it was never asked', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() =>
                    Promise.reject(new SourceBusyError('usda', 'blocked', '2026-10-01T07:00:00.000Z')),
                ),
                crosswalkDouble(),
            );

            const thrown = await service.search('egg').catch((error: unknown) => error);

            expect(isFetchUnavailableError(thrown)).toBe(true);
            expect(isSourceUnavailableError(thrown)).toBe(false);
        });

        it('reports our own accounting failure as UNAVAILABLE (502), never as busy', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() =>
                    Promise.reject(new SourceAccountingError('usda', 'admit', new Error('database down'))),
                ),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });
    });

    describe('the three outcomes a cook must be able to tell apart', () => {
        it('returns the source’s hits on success', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('Egg, whole, raw', '748967')])),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).resolves.toEqual({
                results: [{ name: 'Egg, whole, raw' }],
            });
        });

        it('returns an EMPTY result set — "the source has nothing" is a success, not a failure', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([])),
                crosswalkDouble(),
            );

            // ⛔ Distinct from every rejection below. A cook who sees "USDA has nothing" should stop looking;
            // one who sees "USDA did not answer" should try again. Collapsing them strands the first cook.
            await expect(service.search('nosuchfood')).resolves.toEqual({ results: [] });
        });

        it('rejects as UNAVAILABLE when the source fails in transport (statusCode 0)', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 0, 'timeout'))),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });

        it('rejects as UNAVAILABLE on a source 5xx', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 503, 'upstream down'))),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isSourceUnavailableError);
        });

        it('rejects as BUSY on a source 429: the transport has blocked the source for every task', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new SourceApiError('usda', 429, 'rate limited'))),
                crosswalkDouble(),
            );

            await expect(service.search('egg')).rejects.toSatisfy(isFetchUnavailableError);
        });

        it('rejects as UNAVAILABLE when the adapter throws something unclassified', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.reject(new TypeError('undefined is not a function'))),
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
                crosswalkDouble(),
            );

            expect(JSON.stringify(await service.search('egg'))).not.toContain('748967');
        });

        // Rewritten for curated U8 S4 (R19): an admitted hit is shown under the ROOT that stands for it, never the
        // source's raw description.
        it('carries the INTERNAL root id, under the root’s name, for a hit already admitted to our catalog', async () => {
            const service = new LiveFoodSearchService(
                registryDouble(() =>
                    Promise.resolve([candidate('Egg, whole, raw', '748967'), candidate('Egg, white, raw', '999')]),
                ),
                crosswalkDouble({ '748967': 'food_01ABC' }),
            );

            // An already-admitted hit can be picked with ZERO further source calls; an unknown one cannot,
            // and saying which is which is the difference between a free pick and another quota charge.
            await expect(service.search('egg')).resolves.toEqual({
                results: [{ name: 'root of food_01ABC', id: 'food_01ABC' }, { name: 'Egg, white, raw' }],
            });
        });

        // Rewritten for curated U8 S4: the batch is the owner reader's, one call per source.
        it('resolves owners in ONE batch call rather than once per hit', async () => {
            const ownersOfKeys = vi.fn(() => Promise.resolve(new Map<string, CatalogOwner>()));
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([candidate('a', '1'), candidate('b', '2'), candidate('c', '3')])),
                { ownersOfKeys } as unknown as CatalogOwnerReader,
            );

            await service.search('egg');

            expect(ownersOfKeys).toHaveBeenCalledTimes(1);
            expect(ownersOfKeys).toHaveBeenCalledWith('usda', ['1', '2', '3']);
        });

        it('skips the owner read entirely when the source returned nothing', async () => {
            const ownersOfKeys = vi.fn(() => Promise.resolve(new Map<string, CatalogOwner>()));
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve([])),
                {
                    ownersOfKeys,
                } as unknown as CatalogOwnerReader,
            );

            await service.search('egg');

            expect(ownersOfKeys).not.toHaveBeenCalled();
        });
    });

    describe('bounds', () => {
        it(`truncates to ${LIVE_SEARCH_RESULT_LIMIT} results, so one source cannot flood the picker`, async () => {
            const hits = Array.from({ length: LIVE_SEARCH_RESULT_LIMIT + 7 }, (_unused, index) =>
                candidate(`food ${index}`, String(index)),
            );
            const service = new LiveFoodSearchService(
                registryDouble(() => Promise.resolve(hits)),
                crosswalkDouble(),
            );

            const response = await service.search('egg');

            expect(response.results).toHaveLength(LIVE_SEARCH_RESULT_LIMIT);
            // Truncation happens BEFORE the crosswalk, so the discarded tail costs no database work either.
            expect(response.results.at(-1)?.name).toBe(`food ${LIVE_SEARCH_RESULT_LIMIT - 1}`);
        });

        it(`refuses a query below the ${MIN_SEARCH_QUERY_LENGTH}-character minimum WITHOUT asking the source`, async () => {
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(registryDouble(searchByName), crosswalkDouble());

            // 003-FR-010a. ⛔ Unlike the LOCAL `/foods/search`, which short-circuits to an empty page, this
            // one REJECTS: an empty page here is indistinguishable from "the source has nothing", and the
            // whole surface turns on that distinction. The client gates first; this is the authority.
            await expect(service.search('eg')).rejects.toThrow();
            expect(searchByName).not.toHaveBeenCalled();
        });

        it('trims the query before measuring it against the minimum', async () => {
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(registryDouble(searchByName), crosswalkDouble());

            await expect(service.search('  eg  ')).rejects.toThrow();
            expect(searchByName).not.toHaveBeenCalled();
        });

        it('passes the TRIMMED query to the source, never the raw box text', async () => {
            const searchByName = vi.fn(() => Promise.resolve([]));
            const service = new LiveFoodSearchService(registryDouble(searchByName), crosswalkDouble());

            await service.search('  egg  ');

            expect(searchByName).toHaveBeenCalledWith('egg');
        });
    });
});
