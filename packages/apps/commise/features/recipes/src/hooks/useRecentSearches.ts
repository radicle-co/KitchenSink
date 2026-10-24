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
 * **Persistence is best-effort, injected, and PER USER.** The {@link RecentSearchStore} port is supplied by the platform
 * container (web `localStorage`, native `AsyncStorage`); omit it and the history simply lives for the session. The stored
 * history is keyed by the signed-in user ({@link recentSearchesKeyFor}), so a device shared by two people holds two
 * histories and each sees only their own — owner ruling 2026-10-17 in `docs/design/uiOverhaul/ownerDecisions.md`, which
 * also ends the history with the session (`endDeviceSession`). While nobody is signed in, or Clerk has not said yet, the
 * hook neither reads nor writes: searches live in memory and join the user's stored history once their id arrives. A
 * change of user empties what is shown in the SAME render and re-reads the new user's key. Read/write failures degrade to
 * "no history", never to a broken search — a lost convenience must not take the discovery surface down.
 */
import { useEffect, useReducer } from 'react';

import {
    addRecentSearch,
    mergeRecentSearches,
    parseRecentSearches,
    recentSearchesKeyFor,
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
    /**
     * Whose history `queries` is: a user's id, or `undefined` while nobody is signed in or Clerk has not said. Entries
     * under `undefined` are this session's own and have no stored history to wait for.
     */
    readonly scope: string | undefined;
    /** Whether `scope`'s stored history has been read yet — gates every write (see the module doc's race note). */
    readonly hydrated: boolean;
    readonly queries: readonly string[];
    /**
     * The query THIS session recorded last, if any. It lets a later query replace a partial one typed just before it
     * (A-027) without ever replacing a search an earlier session stored.
     */
    readonly lastRecorded?: string;
}

type RecentSearchesAction =
    | { readonly type: 'rescope'; readonly scope: string | undefined }
    | { readonly type: 'hydrate'; readonly scope: string; readonly queries: readonly string[] }
    | { readonly type: 'record'; readonly query: string }
    | { readonly type: 'clear' };

const INITIAL_STATE: RecentSearchesState = { scope: undefined, hydrated: false, queries: [] };

/** Pure reducer for the history. Every list rule lives in the model; this only sequences the transitions. */
function recentSearchesReducer(state: RecentSearchesState, action: RecentSearchesAction): RecentSearchesState {
    switch (action.type) {
        case 'rescope':
            if (action.scope === state.scope) {
                return state;
            }

            // Entries held while nobody was known are this session's own and move to the user who arrives. Any other
            // change (a user to another user, or to nobody) must leave NOTHING of the previous user behind.
            return state.scope === undefined
                ? { ...state, scope: action.scope, hydrated: false }
                : { scope: action.scope, hydrated: false, queries: [] };

        case 'hydrate':
            // A read for a user who is no longer the scope landed late: it is not this user's history.
            if (action.scope !== state.scope) {
                return state;
            }

            // Anything recorded before the read resolved is NEWER than what was on disk, so it stays in
            // front; merging (rather than replacing) is what keeps both sides.
            return { ...state, hydrated: true, queries: mergeRecentSearches(state.queries, action.queries) };

        case 'record': {
            const queries = addRecentSearch(state.queries, action.query, state.lastRecorded);

            // `addRecentSearch` returns the SAME reference when there is nothing to record, so an unchanged
            // state object here means no re-render and no write.
            return queries === state.queries ? state : { ...state, queries, lastRecorded: action.query };
        }

        case 'clear':
            return state.queries.length === 0 ? state : { scope: state.scope, hydrated: state.hydrated, queries: [] };
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
 * @param subject - The signed-in user's id; `null` when signed out, `undefined` while that is not yet known. Neither
 *   reads nor writes the store.
 * @returns The history plus `clear`.
 */
export function useRecentSearches(
    committedQuery: string,
    store?: RecentSearchStore,
    subject?: string | null,
): UseRecentSearchesResult {
    const [state, dispatch] = useReducer(recentSearchesReducer, INITIAL_STATE);
    const scope = subject ?? undefined;

    // Follow the signed-in user, and read their stored history once per (store, user) — external-system sync, the only
    // thing effects are for here. Declared BEFORE the record effect so that, in a commit that changes both, the scope
    // moves first. A rejected read is indistinguishable from "nothing stored", and both must still mark the state
    // hydrated, or nothing would ever be persisted again.
    useEffect(() => {
        dispatch({ type: 'rescope', scope });

        if (store === undefined || scope === undefined) {
            return;
        }

        let active = true;

        const hydrate = (queries: readonly string[]): void => {
            if (active) {
                dispatch({ type: 'hydrate', scope, queries });
            }
        };

        void store
            .getItem(recentSearchesKeyFor(scope))
            .then((raw) => hydrate(parseRecentSearches(raw)))
            .catch(() => hydrate([]));

        return () => {
            active = false;
        };
    }, [store, scope]);

    // Record the committed query. Gated on the trimmed value being non-empty, so clearing the field (or a
    // whitespace-only query) records nothing.
    useEffect(() => {
        if (committedQuery.trim().length === 0) {
            return;
        }

        dispatch({ type: 'record', query: committedQuery });
    }, [committedQuery]);

    // Persist — only once THIS user's history is hydrated, so an early record cannot overwrite a history that has not
    // been read yet, and a list that still belongs to the previous user is never written under the new one's key. The
    // first post-hydration write is usually the same payload back; that is deliberate and cheap: it also NORMALIZES a
    // stored payload that was over the cap, duplicated, or hand-edited.
    useEffect(() => {
        if (!state.hydrated || store === undefined || scope === undefined || state.scope !== scope) {
            return;
        }

        void store.setItem(recentSearchesKeyFor(scope), serializeRecentSearches(state.queries)).catch(() => undefined);
    }, [state.hydrated, state.queries, state.scope, store, scope]);

    return {
        // The reducer follows `scope` one render late (it moves in an effect); this keeps that render from showing the
        // previous user's list.
        queries: state.scope === scope ? state.queries : [],
        clear: () => dispatch({ type: 'clear' }),
    };
}
