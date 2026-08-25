/**
 * Unit suite for the pure ON-DEMAND live-search model (plan U29) — the state machine behind the picker's
 * "Search USDA for '…'" control, on BOTH platforms.
 *
 * ⛔ **Three settled outcomes, and they must never collapse into two.** `empty` means the source answered
 * and has nothing for this query — the cook should stop looking. `busy` means our reserved rate lane (or
 * the source's own limit) refused — try again shortly. `failed` means the source did not answer — try again,
 * but nothing knows when. Each leads to a different sentence and a different next action, so a derivation
 * that folds any pair strands a cook in the wrong loop. Most cases below exist for exactly that.
 *
 * ⛔ **A result belongs to the query it was fetched FOR.** The moment the cook types on, the panel must
 * return to idle rather than keep showing hits for a phrase that is no longer in the box — otherwise they
 * pick "Broccoli, raw" for a line they are now calling "cauliflower".
 *
 * @implements FR-010a
 */
import { describe, expect, it } from 'vitest';
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import { canRunLiveSearch, deriveLiveSearchState } from '../liveIngredientSearch.model.js';
import type { DeriveLiveSearchInput } from '../liveIngredientSearch.model.js';

/** The settled, successful shape of one live search. */
const HITS = [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }] as const;

/** A baseline input: nothing has been searched yet. */
function input(overrides: Partial<DeriveLiveSearchInput> = {}): DeriveLiveSearchInput {
    return {
        searchedQuery: null,
        trimmed: '',
        isPending: false,
        data: undefined,
        error: undefined,
        ...overrides,
    };
}

describe('deriveLiveSearchState', () => {
    it('is idle before the cook has pressed anything, however much they have typed', () => {
        expect(deriveLiveSearchState(input({ trimmed: 'broccoli' }))).toEqual({ kind: 'idle' });
    });

    it('is searching while the request is in flight, naming the query it is for', () => {
        expect(
            deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', isPending: true })),
        ).toEqual({ kind: 'searching', query: 'broccoli' });
    });

    it('reports hits when the source found something', () => {
        expect(
            deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', data: { hits: [...HITS] } })),
        ).toEqual({ kind: 'results', query: 'broccoli', hits: HITS });
    });

    it('reports EMPTY — not failed — when the source answered with nothing', () => {
        // ⛔ The cook should stop looking. Rendering this as a failure would send them round the retry loop
        // for a food the source has already said it does not have.
        expect(deriveLiveSearchState(input({ trimmed: 'zzzz', searchedQuery: 'zzzz', data: { hits: [] } }))).toEqual({
            kind: 'empty',
            query: 'zzzz',
        });
    });

    it('reports BUSY, with the retry window, when the rate budget refused', () => {
        const error = { name: 'SourceBusyError', retryAfterSeconds: 60 };

        expect(deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', error }))).toEqual({
            kind: 'busy',
            query: 'broccoli',
            retryAfterSeconds: 60,
        });
    });

    it('reports BUSY without a window when none was supplied, rather than inventing one', () => {
        const error = { name: 'SourceBusyError' };

        expect(deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', error }))).toEqual({
            kind: 'busy',
            query: 'broccoli',
        });
    });

    it('reports FAILED — a DIFFERENT state from busy — when the source did not answer', () => {
        const error = { name: 'SourceUnavailableError' };

        expect(deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', error }))).toEqual({
            kind: 'failed',
            query: 'broccoli',
        });
    });

    it('reports FAILED for any other error, so no failure can render as a success', () => {
        expect(
            deriveLiveSearchState(input({ trimmed: 'broccoli', searchedQuery: 'broccoli', error: new Error('boom') })),
        ).toEqual({ kind: 'failed', query: 'broccoli' });
    });

    it('prefers the ERROR over stale data, so a failed retry cannot show the previous run’s hits', () => {
        // A mutation keeps its last successful `data` after a subsequent failure. Reading `data` first would
        // render the earlier results under a failure the cook was never told about.
        expect(
            deriveLiveSearchState(
                input({
                    trimmed: 'broccoli',
                    searchedQuery: 'broccoli',
                    data: { hits: [...HITS] },
                    error: { name: 'SourceUnavailableError' },
                }),
            ),
        ).toEqual({ kind: 'failed', query: 'broccoli' });
    });

    it('returns to idle the moment the cook types on — results belong to the query they were fetched for', () => {
        // ⛔ Without this, hits for "broccoli" stay on screen under a box reading "cauliflower", and the cook
        // picks a food for a line they have already renamed.
        expect(
            deriveLiveSearchState(
                input({ trimmed: 'cauliflower', searchedQuery: 'broccoli', data: { hits: [...HITS] } }),
            ),
        ).toEqual({ kind: 'idle' });
    });

    it('also drops a stale FAILURE when the query moves on', () => {
        expect(
            deriveLiveSearchState(
                input({ trimmed: 'cauliflower', searchedQuery: 'broccoli', error: { name: 'SourceBusyError' } }),
            ),
        ).toEqual({ kind: 'idle' });
    });

    it('keeps an in-flight search visible even after the cook types on, so the panel does not flicker', () => {
        // The request is still running and will settle; hiding it would blank the panel mid-wait and then
        // pop it back. Only a SETTLED result is discarded on a query change.
        expect(
            deriveLiveSearchState(input({ trimmed: 'cauliflower', searchedQuery: 'broccoli', isPending: true })),
        ).toEqual({ kind: 'searching', query: 'broccoli' });
    });
});

describe('canRunLiveSearch', () => {
    it(`refuses a query below the ${MIN_SEARCH_QUERY_LENGTH}-character minimum (003-FR-010a)`, () => {
        expect(canRunLiveSearch('br', false)).toBe(false);
    });

    it('allows a query at exactly the minimum — three-character foods are real (egg, ham, rye)', () => {
        expect(canRunLiveSearch('egg', false)).toBe(true);
    });

    it('refuses while a search is already in flight, so one press cannot spend the lane twice', () => {
        expect(canRunLiveSearch('broccoli', true)).toBe(false);
    });

    it('refuses an empty query', () => {
        expect(canRunLiveSearch('', false)).toBe(false);
    });
});
