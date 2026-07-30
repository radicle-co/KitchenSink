/**
 * Cache probes for asserting the recipe-service mutation hooks' **invalidation** contract (T064) as an
 * observable cache outcome rather than as "the spy was called".
 *
 * A probe is a seeded, observer-less cache entry at a **literal** query key. `invalidateQueries` marks
 * every entry matching its (prefix) filter `isInvalidated: true`; an entry outside the filter stays clean.
 * So seeding one probe per region of the key namespace and reading back which probes flipped yields the
 * exact set of cache regions a mutation invalidated — under-invalidation and over-invalidation both fail.
 *
 * The keys below are written out **literally on purpose** and are NOT derived from `recipeServiceKeys`. An
 * assertion built from the factory would mirror whatever the factory says and stay green when a key
 * changes — the probes are the independent oracle that makes such a change fail.
 */
import type { QueryClient } from '@tanstack/react-query';

/** The recipe/collection ids the mutation tests act on (`_a`) and the controls they must not touch (`_b`). */
export const PROBE_RECIPE_ID = 'rec_a';
export const PROBE_OTHER_RECIPE_ID = 'rec_b';
export const PROBE_COLLECTION_ID = 'col_a';
export const PROBE_OTHER_COLLECTION_ID = 'col_b';

/**
 * One seeded cache entry per region of the recipe-service key namespace, keyed by a readable probe name.
 * Every key is a literal — see the module comment for why.
 */
export const CACHE_PROBES = {
    recipeList: ['recipe-service', 'recipes', 'list', {}],
    recipeA: ['recipe-service', 'recipes', 'detail', 'rec_a'],
    recipeAVersions: ['recipe-service', 'recipes', 'detail', 'rec_a', 'versions'],
    recipeAPhotos: ['recipe-service', 'recipes', 'detail', 'rec_a', 'photos'],
    recipeB: ['recipe-service', 'recipes', 'detail', 'rec_b'],
    collectionList: ['recipe-service', 'collections', 'list', {}],
    collectionA: ['recipe-service', 'collections', 'detail', 'col_a'],
    collectionB: ['recipe-service', 'collections', 'detail', 'col_b'],
    recipeSearch: ['recipe-service', 'search', 'recipes', {}],
    ingredientSearch: ['recipe-service', 'search', 'ingredients', 'tom', null],
} as const satisfies Record<string, readonly unknown[]>;

/** A probe's name — the readable handle an invalidation assertion is written in terms of. */
export type CacheProbeName = keyof typeof CACHE_PROBES;

/** Every probe name, in declaration order. */
const PROBE_NAMES = Object.keys(CACHE_PROBES) as CacheProbeName[];

/**
 * Seed every probe as a fresh, valid (non-invalidated) cache entry.
 *
 * @param queryClient - The client whose cache to seed.
 * @sideEffect Writes one cache entry per probe.
 */
export function seedCacheProbes(queryClient: QueryClient): void {
    for (const name of PROBE_NAMES) {
        queryClient.setQueryData(CACHE_PROBES[name], { probe: name });
    }
}

/**
 * The probes an invalidation has marked stale, as sorted names.
 *
 * @param queryClient - The client whose cache to read.
 * @returns The names of every probe with `isInvalidated: true`, sorted for order-independent comparison.
 */
export function invalidatedProbes(queryClient: QueryClient): CacheProbeName[] {
    return PROBE_NAMES.filter((name) => queryClient.getQueryState(CACHE_PROBES[name])?.isInvalidated === true).sort();
}

/**
 * Assert that a mutation invalidated **exactly** the named probes — no more, no less.
 *
 * @param queryClient - The client whose cache to read.
 * @param expected - The probes that must be stale; every other probe must still be valid.
 * @returns The sorted expected names, for comparison against {@link invalidatedProbes}.
 */
export function expectedProbes(expected: readonly CacheProbeName[]): CacheProbeName[] {
    return [...expected].sort();
}
