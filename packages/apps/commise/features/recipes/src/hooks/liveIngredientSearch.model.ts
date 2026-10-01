/**
 * Headless-hook seam (CP-6/P2) — the pure state model for the ON-DEMAND live source search (plan U29), the
 * behaviour behind the picker's "Search USDA for '…'" control on BOTH platforms. No React, no client hooks:
 * only the derivation and the gate, so the logic each leaf renders is unit-testable on its own.
 *
 * ── WHY THIS IS A PRESS, NOT A TYPEAHEAD ────────────────────────────────────────────────────────
 * The upstream source allows 1,000 requests/hour PER IP (ours, shared by every cook), and 003's FR-019
 * reserves only the top 10% of that for user-facing work. At 50 concurrent cooks even a PERFECT
 * one-call-per-settled-query autocomplete would want roughly three times the entire key — so a live blend
 * is not a debouncing problem, it is arithmetically impossible. ⛔ Do not add a debounce and auto-fire this,
 * and do not auto-fire it when the local results look thin: both are the same mistake wearing a threshold.
 * The structural guard is upstream of this file — the search is a TanStack MUTATION, which runs only when
 * something calls it — and this model is what the mutation's raw flags reduce to.
 *
 * ── WHY THERE ARE THREE SETTLED FAILURE-ISH STATES AND NOT ONE ──────────────────────────────────
 * `empty` — the source answered and has nothing for this query. The cook should STOP looking and name the
 * ingredient themselves. `busy` — our reserved lane (or the source's own limit) refused; the search never
 * happened and is worth repeating shortly. `failed` — the source did not answer; also worth repeating, but
 * nothing here knows when it recovers, so no window is promised. Collapsing any pair sends a cook round a
 * loop that cannot end: retrying a food the source has already said it does not have, or abandoning one it
 * would have found.
 *
 * @implements FR-010a
 */
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import type { LiveIngredientHit, LiveIngredientSearchResponse } from '@kitchensink/recipe-service-client';

/**
 * The live-search panel's current view — a discriminated union so each leaf renders it with an exhaustive
 * switch rather than re-deriving the machine from raw mutation flags. Every settled kind carries the QUERY
 * it belongs to, so the copy a cook reads always names the phrase that was actually searched.
 */
export type LiveSearchViewState =
    /** Nothing has been searched, or the cook has typed on since the last settled result. */
    | { readonly kind: 'idle' }
    /** A search is in flight. Expected to last SECONDS — this is the slow path by design. */
    | { readonly kind: 'searching'; readonly query: string }
    /** The source found something. */
    | { readonly kind: 'results'; readonly query: string; readonly hits: readonly LiveIngredientHit[] }
    /** The source answered and has nothing. ⛔ A SUCCESS, and never to be rendered as a failure. */
    | { readonly kind: 'empty'; readonly query: string }
    /** A rate refusal — ours or the source's. Worth retrying; `retryAfterSeconds` when it is known. */
    | { readonly kind: 'busy'; readonly query: string; readonly retryAfterSeconds?: number }
    /** The source did not answer. Worth retrying, but with no window anything here can promise. */
    | { readonly kind: 'failed'; readonly query: string };

/** The raw mutation facts {@link deriveLiveSearchState} reduces to one {@link LiveSearchViewState}. */
export interface DeriveLiveSearchInput {
    /**
     * The query the last search was issued FOR, or `null` when none has been. Distinct from `trimmed` so a
     * settled result can be recognised as belonging to a phrase the cook has since edited.
     */
    readonly searchedQuery: string | null;
    /** The current trimmed search-box text. */
    readonly trimmed: string;
    /** Whether a live search is in flight. */
    readonly isPending: boolean;
    /** The last successful response, if any. */
    readonly data: LiveIngredientSearchResponse | undefined;
    /** The last failure, if any. Narrowed by NAME rather than by class — see {@link deriveLiveSearchState}. */
    readonly error: unknown;
}

/** The client error name that means a rate refusal rather than an outage. */
const BUSY_ERROR_NAME = 'SourceBusyError';

/**
 * Reduce the live search's raw facts to the one state a leaf renders.
 *
 * ⚠️ The failure is discriminated on `error.name`, not `instanceof`. This model is imported by web, by
 * mobile and by their test suites, and an `instanceof` across a bundler boundary is exactly the check that
 * silently starts returning `false` when two copies of a module exist — which would render every rate
 * refusal as an outage. The name is part of the client's published error contract and is asserted there.
 *
 * @param input - The current mutation facts plus the box text.
 * @returns The single state a leaf renders. Pure.
 */
export function deriveLiveSearchState(input: DeriveLiveSearchInput): LiveSearchViewState {
    const { searchedQuery } = input;

    if (searchedQuery === null) {
        return { kind: 'idle' };
    }

    // An in-flight search survives a query change on purpose: it WILL settle, and blanking the panel
    // mid-wait only to pop it back is worse than briefly showing what is genuinely still running.
    if (input.isPending) {
        return { kind: 'searching', query: searchedQuery };
    }

    // ⛔ A SETTLED result belongs to the query it was fetched for. Once the cook has typed on, showing it
    // would let them pick a food for a line they have already renamed.
    if (input.trimmed !== searchedQuery) {
        return { kind: 'idle' };
    }

    // The error is read BEFORE the data: a mutation keeps its last successful payload after a later
    // failure, so reading data first would render the previous run's hits under a failure nobody mentioned.
    if (input.error !== undefined && input.error !== null) {
        const { name, retryAfterSeconds } = input.error as { name?: unknown; retryAfterSeconds?: unknown };

        if (name === BUSY_ERROR_NAME) {
            return typeof retryAfterSeconds === 'number'
                ? { kind: 'busy', query: searchedQuery, retryAfterSeconds }
                : { kind: 'busy', query: searchedQuery };
        }

        return { kind: 'failed', query: searchedQuery };
    }

    if (input.data === undefined) {
        return { kind: 'idle' };
    }

    return input.data.hits.length === 0
        ? { kind: 'empty', query: searchedQuery }
        : { kind: 'results', query: searchedQuery, hits: input.data.hits };
}

/**
 * Whether the on-demand search may be run right now — the gate the affordance's `disabled` state reads.
 *
 * Two conditions, and both are load-bearing. The 003-FR-010a minimum keeps a query that the server would
 * refuse anyway from costing a round trip on a path that spends a SHARED external quota. The in-flight
 * check keeps one impatient cook from spending the lane several times over on the same phrase.
 *
 * @param trimmed - The current trimmed search-box text.
 * @param isPending - Whether a live search is already in flight.
 * @returns Whether a search may be issued. Pure.
 */
export function canRunLiveSearch(trimmed: string, isPending: boolean): boolean {
    return !isPending && meetsSearchMinimum(trimmed);
}
