import { describe, expect, it } from 'vitest';

import { toDetailQueryView, toQueryStatus } from '../queryStatus.js';

/**
 * Unit tests for the shared query-status discriminator (DA8). The facts are TanStack's own flags, passed as the query
 * result itself, and the error half is `isLoadingError`: a read that failed with NOTHING to show. A refetch that
 * fails over data already on screen sets `isError` too, and treating that as the page's error replaced live rows
 * with an error screen, which is the defect these pin shut.
 */
describe('toQueryStatus', () => {
    it('returns "loading" when the query is loading', () => {
        expect(toQueryStatus({ isLoading: true, isLoadingError: false })).toBe('loading');
    });

    it('returns "error" when the read failed with nothing loaded', () => {
        expect(toQueryStatus({ isLoading: false, isLoadingError: true })).toBe('error');
    });

    it('returns "ready" when neither loading nor failed to load', () => {
        expect(toQueryStatus({ isLoading: false, isLoadingError: false })).toBe('ready');
    });

    it('⛔ is "ready" for a failed REFETCH over loaded data — the rows stay, the failure is reported inline', () => {
        // A real result's shape: `isError` is true, but it is a refetch error, not a loading error.
        const refetchFailed = { isLoading: false, isError: true, isLoadingError: false, isRefetchError: true };

        expect(toQueryStatus(refetchFailed)).toBe('ready');
    });

    it('gives loading precedence over a loading error', () => {
        expect(toQueryStatus({ isLoading: true, isLoadingError: true })).toBe('loading');
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
        expect(toDetailQueryView({ isLoading: true, isLoadingError: false, data: undefined })).toStrictEqual({
            status: 'loading',
        });
    });

    it('is "error" when the read failed with nothing loaded', () => {
        expect(toDetailQueryView({ isLoading: false, isLoadingError: true, data: undefined })).toStrictEqual({
            status: 'error',
        });
    });

    it('is "ready" — carrying the datum — when the query settled WITH data', () => {
        expect(toDetailQueryView({ isLoading: false, isLoadingError: false, data: 'recipe' })).toStrictEqual({
            status: 'ready',
            data: 'recipe',
        });
    });

    it('is "error" — NOT "loading" — when the query settled with NOTHING', () => {
        // The whole point: settled-but-absent is a dead end unless it is reported as a failure.
        expect(toDetailQueryView({ isLoading: false, isLoadingError: false, data: undefined })).toStrictEqual({
            status: 'error',
        });
    });

    it('keeps loading precedence over both error and absent data (loading beats everything)', () => {
        expect(toDetailQueryView({ isLoading: true, isLoadingError: true, data: undefined })).toStrictEqual({
            status: 'loading',
        });
    });

    it('⛔ is "ready" — keeping the datum — when a REFETCH fails over it', () => {
        const refetchFailed = { isLoading: false, isError: true, isLoadingError: false, data: 'recipe' };

        expect(toDetailQueryView(refetchFailed)).toStrictEqual({ status: 'ready', data: 'recipe' });
    });

    it('treats a falsy-but-present datum as present — absence means `undefined`, not falsiness', () => {
        // A mutation-lens guard: swapping the `data === undefined` check for a truthiness test would classify
        // a legitimately empty/zero payload as a failure.
        expect(toDetailQueryView({ isLoading: false, isLoadingError: false, data: 0 })).toStrictEqual({
            status: 'ready',
            data: 0,
        });
        expect(toDetailQueryView({ isLoading: false, isLoadingError: false, data: null })).toStrictEqual({
            status: 'ready',
            data: null,
        });
    });
});
