import { describe, expect, it } from 'vitest';

import { toDetailQueryView, toQueryStatus } from '../queryStatus.js';

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

/**
 * Unit tests for the SETTLED-BUT-ABSENT rule (B21). A detail surface has exactly one datum to render; a
 * query that has stopped loading, carries no error, and still has no data has SETTLED WITH NOTHING — that
 * is a failure, not a pending fetch. The three web detail containers each routed that case back into their
 * LOADING affordance (a permanent spinner with no retry) while their mobile equivalents routed it into
 * ERROR; this discriminator states the rule ONCE so the two platforms cannot disagree again.
 */
describe('toDetailQueryView', () => {
    it('is "loading" while the query is loading, even before any data exists', () => {
        expect(toDetailQueryView({ isLoading: true, isError: false, data: undefined })).toStrictEqual({
            status: 'loading',
        });
    });

    it('is "error" when the query errored', () => {
        expect(toDetailQueryView({ isLoading: false, isError: true, data: undefined })).toStrictEqual({
            status: 'error',
        });
    });

    it('is "ready" — carrying the datum — when the query settled WITH data', () => {
        expect(toDetailQueryView({ isLoading: false, isError: false, data: 'recipe' })).toStrictEqual({
            status: 'ready',
            data: 'recipe',
        });
    });

    it('is "error" — NOT "loading" — when the query settled with NOTHING', () => {
        // The whole point: settled-but-absent is a dead end unless it is reported as a failure.
        expect(toDetailQueryView({ isLoading: false, isError: false, data: undefined })).toStrictEqual({
            status: 'error',
        });
    });

    it('keeps loading precedence over both error and absent data (loading beats everything)', () => {
        expect(toDetailQueryView({ isLoading: true, isError: true, data: undefined })).toStrictEqual({
            status: 'loading',
        });
    });

    it('is "error" for an errored query even when stale data is still present', () => {
        expect(toDetailQueryView({ isLoading: false, isError: true, data: 'stale' })).toStrictEqual({
            status: 'error',
        });
    });

    it('treats a falsy-but-present datum as present — absence means `undefined`, not falsiness', () => {
        // A mutation-lens guard: swapping the `data === undefined` check for a truthiness test would classify
        // a legitimately empty/zero payload as a failure.
        expect(toDetailQueryView({ isLoading: false, isError: false, data: 0 })).toStrictEqual({
            status: 'ready',
            data: 0,
        });
        expect(toDetailQueryView({ isLoading: false, isError: false, data: null })).toStrictEqual({
            status: 'ready',
            data: null,
        });
    });
});
