/**
 * The Data sources page's read state (curated U25; `docs/design/ingredientSpecialization.md` §S16 "States").
 */
import { describe, expect, it } from 'vitest';

import { CIQUAL_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { type DataSourcesQueryView, dataSourcesViewOf } from '../dataSourcesView.js';

const USDA = makeDataSource();

/** A read with no data yet, in `fetchStatus`. */
const unread = (fetchStatus: DataSourcesQueryView['fetchStatus'], isError = false): DataSourcesQueryView => ({
    data: undefined,
    isError,
    fetchStatus,
});

describe('dataSourcesViewOf', () => {
    it('is loading while the first read is in flight', () => {
        expect(dataSourcesViewOf(true, unread('fetching'), false)).toEqual({ kind: 'loading' });
    });

    it('keeps loading for a read parked while the app has no focus', () => {
        expect(dataSourcesViewOf(false, unread('paused'), false)).toEqual({ kind: 'loading' });
    });

    it('is offline for a parked read, never loading', () => {
        expect(dataSourcesViewOf(true, unread('paused'), false)).toEqual({ kind: 'offline' });
    });

    it('is an error once the read failed', () => {
        expect(dataSourcesViewOf(true, unread('idle', true), false)).toEqual({ kind: 'error', retrying: false });
    });

    /**
     * ⚠️ This REPLACES "loading again while Try again runs". Loading unmounted Try again under the cook's focus and the
     * screen reader's cursor (`docs/design/readSurfacesEvaluation.md` D3, SC 2.4.3), so a failure on screen stays on
     * screen while the read runs again, with Try again busy. TanStack resets a data-less query to `pending` when it
     * fetches again, so the read itself no longer says it failed: the page's own previous view does.
     */
    it('keeps the failure on screen, retrying, while the read runs again', () => {
        expect(dataSourcesViewOf(true, unread('fetching'), true)).toEqual({ kind: 'error', retrying: true });
    });

    it('keeps the failure on screen while a retry waits for the app to come back', () => {
        expect(dataSourcesViewOf(false, unread('paused'), true)).toEqual({ kind: 'error', retrying: true });
    });

    it('is offline, never the failure, for a retry parked while the app has focus', () => {
        expect(dataSourcesViewOf(true, unread('paused'), true)).toEqual({ kind: 'offline' });
    });

    // A page that opens on a read that failed earlier (TanStack keeps the failed query for its cache time) is reading,
    // not retrying: it has shown no failure, so it shows none until this read fails.
    it('is loading, never the failure, for a page that has shown no failure', () => {
        expect(dataSourcesViewOf(true, unread('fetching'), false)).toEqual({ kind: 'loading' });
    });

    it('shows the sources in the order the service sent them', () => {
        expect(
            dataSourcesViewOf(
                true,
                { data: { sources: [USDA, CIQUAL_SOURCE] }, isError: false, fetchStatus: 'idle' },
                false,
            ),
        ).toEqual({ kind: 'loaded', sources: [USDA, CIQUAL_SOURCE] });
    });

    it('keeps the sources it has while a refetch fails or parks', () => {
        const data = { sources: [USDA] };

        expect(dataSourcesViewOf(true, { data, isError: true, fetchStatus: 'idle' }, false)).toEqual({
            kind: 'loaded',
            sources: [USDA],
        });
        expect(dataSourcesViewOf(true, { data, isError: false, fetchStatus: 'paused' }, false)).toEqual({
            kind: 'loaded',
            sources: [USDA],
        });
    });
});
