/**
 * Recent-search memory for discovery's keyword field (U7) — the headless half of the "recent searches"
 * feature: it owns the history state, when an entry is recorded, and its persistence, while the
 * presentational discovery view owns only when the panel is VISIBLE (focused + blank query).
 *
 * **What counts as a search.** The hook is driven by the COMMITTED query — the debounced value the container
 * actually feeds `useInfiniteSearchRecipes` — never by keystrokes. So a search enters the history exactly
 * when it produced a fetch, which is the only definition that matches what the user perceives as "a search
 * I ran". Blank/whitespace-only committed values are ignored, so clearing the field records nothing.
 *
 * **Statechart over a pure reducer.** Three actions (`hydrate` / `record` / `clear`) over
 * `{ hydrated, queries }`, with every list rule delegated to the pure model
 * (`../discovery/recentSearches.ts`). `hydrated` exists to close the read/record RACE: the stored history
 * arrives asynchronously, so a query committed before it lands is merged IN FRONT of the stored entries
 * (session entries are newer by definition) rather than either side clobbering the other — and nothing is
 * written back until the stored history is known, so an early record can never truncate it.
 *
 * **Persistence is best-effort and injected.** The {@link RecentSearchStore} port is supplied by the
 * platform container (web `localStorage`, native `AsyncStorage`); omit it and the history simply lives for
 * the session. Read/write failures degrade to "no history", never to a broken search — a lost convenience
 * must not take the discovery surface down.
 */
import { useEffect, useReducer } from 'react';

import {
    RECENT_SEARCHES_STORAGE_KEY,
    addRecentSearch,
    mergeRecentSearches,
    parseRecentSearches,
    serializeRecentSearches,
    type RecentSearchStore,
} from '../discovery/recentSearches.js';

/** The state + action {@link useRecentSearches} exposes to a container. */
export interface UseRecentSearchesResult {
    /** The recent searches, newest first, de-duplicated and capped. */
    readonly queries: readonly string[];
    /**
     * Forget every recent search (and persist that).
     *
     * @sideEffect Writes the (now empty) history through the store.
     */
    readonly clear: () => void;
}

interface RecentSearchesState {
    /** Whether the stored history has been read yet — gates every write (see the module doc's race note). */
    readonly hydrated: boolean;
    readonly queries: readonly string[];
}

type RecentSearchesAction =
    | { readonly type: 'hydrate'; readonly queries: readonly string[] }
    | { readonly type: 'record'; readonly query: string }
    | { readonly type: 'clear' };

const INITIAL_STATE: RecentSearchesState = { hydrated: false, queries: [] };

/** Pure reducer for the history. Every list rule lives in the model; this only sequences the transitions. */
function recentSearchesReducer(state: RecentSearchesState, action: RecentSearchesAction): RecentSearchesState {
    switch (action.type) {
        case 'hydrate':
            // Anything recorded before the read resolved is NEWER than what was on disk, so it stays in
            // front; merging (rather than replacing) is what keeps both sides.
            return { hydrated: true, queries: mergeRecentSearches(state.queries, action.queries) };

        case 'record': {
            const queries = addRecentSearch(state.queries, action.query);

            // `addRecentSearch` returns the SAME reference when there is nothing to record, so an unchanged
            // state object here means no re-render and no write.
            return queries === state.queries ? state : { ...state, queries };
        }

        case 'clear':
            return state.queries.length === 0 ? state : { ...state, queries: [] };
        default:
            return state;
    }
}

/**
 * The recent-search history for the discovery keyword field.
 *
 * @param committedQuery - The query that actually ran (the container's DEBOUNCED search value). Recorded
 *   whenever it changes to a non-blank value; never recorded per keystroke.
 * @param store - Optional persistence port. Omitted → the history lives for this session only.
 * @returns The history plus `clear`.
 */
export function useRecentSearches(committedQuery: string, store?: RecentSearchStore): UseRecentSearchesResult {
    const [state, dispatch] = useReducer(recentSearchesReducer, INITIAL_STATE);

    // Read the stored history once per store (external-system sync — the only thing effects are for here).
    // A rejected read is indistinguishable from "nothing stored", and both must still mark the state
    // hydrated, or nothing would ever be persisted again.
    useEffect(() => {
        if (store === undefined) {
            dispatch({ type: 'hydrate', queries: [] });

            return;
        }

        let active = true;

        const hydrate = (queries: readonly string[]): void => {
            if (active) {
                dispatch({ type: 'hydrate', queries });
            }
        };

        void store
            .getItem(RECENT_SEARCHES_STORAGE_KEY)
            .then((raw) => hydrate(parseRecentSearches(raw)))
            .catch(() => hydrate([]));

        return () => {
            active = false;
        };
    }, [store]);

    // Record the committed query. Gated on the trimmed value being non-empty, so clearing the field (or a
    // whitespace-only query) records nothing.
    useEffect(() => {
        if (committedQuery.trim().length === 0) {
            return;
        }

        dispatch({ type: 'record', query: committedQuery });
    }, [committedQuery]);

    // Persist — only once hydrated, so an early record cannot overwrite a history that has not been read
    // yet. The first post-hydration write is usually the same payload back; that is deliberate and cheap:
    // it also NORMALIZES a stored payload that was over the cap, duplicated, or hand-edited.
    useEffect(() => {
        if (!state.hydrated || store === undefined) {
            return;
        }

        void store.setItem(RECENT_SEARCHES_STORAGE_KEY, serializeRecentSearches(state.queries)).catch(() => undefined);
    }, [state.hydrated, state.queries, store]);

    return { queries: state.queries, clear: () => dispatch({ type: 'clear' }) };
}
