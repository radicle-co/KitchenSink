import { describe, expect, it } from 'vitest';

import { toQueryStatus } from '../queryStatus.js';

/**
 * Unit tests for the shared query-status discriminator (DA8). `CollectionListContainer` and
 * `RecipeListContainer` each carried a byte-identical local `toListStatus(isLoading, isError)` helper;
 * these pin the exact branch precedence that code used (loading beats error beats ready) so the dedup
 * to `toQueryStatus` is provably behavior-preserving.
 */
describe('toQueryStatus', () => {
    it('returns "loading" when the query is loading', () => {
        expect(toQueryStatus(true, false)).toBe('loading');
    });

    it('returns "error" when the query has errored and is not loading', () => {
        expect(toQueryStatus(false, true)).toBe('error');
    });

    it('returns "ready" when neither loading nor errored', () => {
        expect(toQueryStatus(false, false)).toBe('ready');
    });

    it('gives loading precedence over error — a query can be loading and errored mid-retry', () => {
        expect(toQueryStatus(true, true)).toBe('loading');
    });
});
