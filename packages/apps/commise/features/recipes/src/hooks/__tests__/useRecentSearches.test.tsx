/**
 * Tests for {@link useRecentSearches} — the recent-search memory behind discovery's keyword field (U7).
 *
 * The hook is driven by the COMMITTED query (the debounced value that actually fed a fetch), never by
 * keystrokes, and it persists through the injected {@link RecentSearchStore} port — so these tests use a
 * fake in-memory store and never touch `localStorage`/`AsyncStorage`. Covered: hydration from storage,
 * recording only a committed non-blank query, case-insensitive de-duplication, the retention cap, clearing,
 * survival across a remount (the "reload" case), the hydrate-vs-record race (a query recorded before the
 * async read resolves must NOT be lost, and must NOT clobber the stored history), and a store whose reads or
 * writes fail (a broken history must never break search).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
    MAX_RECENT_SEARCHES,
    recentSearchesKeyFor,
    serializeRecentSearches,
    type RecentSearchStore,
} from '../../discovery/recentSearches.js';
import { useRecentSearches } from '../useRecentSearches.js';

const SUBJECT = 'user_a';

/** An in-memory {@link RecentSearchStore} double that records every call. */
function makeFakeStore(initial: string | null = null): RecentSearchStore & {
    readonly reads: string[];
    readonly writes: string[];
    value: string | null;
} {
    const reads: string[] = [];
    const writes: string[] = [];
    const state = { value: initial };

    return {
        reads,
        writes,
        get value() {
            return state.value;
        },
        set value(next: string | null) {
            state.value = next;
        },
        getItem: async (key: string) => {
            reads.push(key);

            return state.value;
        },
        setItem: async (_key: string, value: string) => {
            writes.push(value);
            state.value = value;
        },
        removeItem: async () => {
            state.value = null;
        },
    };
}

describe('useRecentSearches — hydration', () => {
    it('starts empty and hydrates the stored history from the port', async () => {
        const store = makeFakeStore(serializeRecentSearches(['pasta', 'risotto']));

        const { result } = renderHook(() => useRecentSearches('', store, SUBJECT));

        expect(result.current.queries).toEqual([]);
        await waitFor(() => expect(result.current.queries).toEqual(['pasta', 'risotto']));
        expect(store.reads).toEqual([recentSearchesKeyFor(SUBJECT)]);
    });

    it('hydrates to an empty history when nothing is stored', async () => {
        const store = makeFakeStore(null);

        const { result } = renderHook(() => useRecentSearches('', store, SUBJECT));

        await waitFor(() => expect(store.reads).toHaveLength(1));
        expect(result.current.queries).toEqual([]);
    });

    it('works with no store at all (nothing persists, nothing throws)', async () => {
        const { result } = renderHook(() => useRecentSearches('pasta'));

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));
    });
});

describe('useRecentSearches — recording a committed query', () => {
    it('records a committed query and persists it', async () => {
        const store = makeFakeStore();

        const { result } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(store.reads).toHaveLength(1));
        expect(result.current.queries).toEqual([]);

        // Nothing was committed yet — an empty field must never write a history entry.
        expect(store.writes.some((write) => write.includes('pasta'))).toBe(false);
    });

    it.each([[''], ['   ']])('records NOTHING for a blank committed query (%j)', async (blank) => {
        const store = makeFakeStore();

        const { result } = renderHook(() => useRecentSearches(blank, store, SUBJECT));

        await waitFor(() => expect(store.reads).toHaveLength(1));
        expect(result.current.queries).toEqual([]);
    });

    it('records each committed query, newest first', async () => {
        const store = makeFakeStore();
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: 'pasta' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));

        rerender({ query: 'risotto' });

        await waitFor(() => expect(result.current.queries).toEqual(['risotto', 'pasta']));
        expect(store.value).toBe(serializeRecentSearches(['risotto', 'pasta']));
    });

    it('collapses the partial queries of one typing run into the one the cook finished on (A-027)', async () => {
        const store = makeFakeStore();
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: 'r' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['r']));
        rerender({ query: 'ri' });
        await waitFor(() => expect(result.current.queries).toEqual(['ri']));
        rerender({ query: 'rice' });

        await waitFor(() => expect(result.current.queries).toEqual(['rice']));
        await waitFor(() => expect(store.value).toBe(serializeRecentSearches(['rice'])));
    });

    it('does not collapse into a search stored by an earlier session', async () => {
        const store = makeFakeStore(serializeRecentSearches(['rice']));
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['rice']));
        rerender({ query: 'r' });

        await waitFor(() => expect(result.current.queries).toEqual(['r', 'rice']));
    });

    it('still records two unrelated searches of one session', async () => {
        const store = makeFakeStore();
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: 'pasta' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));
        rerender({ query: 'risotto' });

        await waitFor(() => expect(result.current.queries).toEqual(['risotto', 'pasta']));
    });

    it('de-duplicates case-insensitively rather than growing the list', async () => {
        const store = makeFakeStore(serializeRecentSearches(['pasta', 'risotto']));
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['pasta', 'risotto']));

        rerender({ query: 'PASTA' });

        await waitFor(() => expect(result.current.queries).toEqual(['PASTA', 'risotto']));
    });

    it('caps the history, evicting the oldest entry', async () => {
        const stored = Array.from({ length: MAX_RECENT_SEARCHES }, (_unused, index) => `query-${index}`);
        const store = makeFakeStore(serializeRecentSearches(stored));
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store, SUBJECT), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(result.current.queries).toHaveLength(MAX_RECENT_SEARCHES));

        rerender({ query: 'newest' });

        await waitFor(() => expect(result.current.queries[0]).toBe('newest'));
        expect(result.current.queries).toHaveLength(MAX_RECENT_SEARCHES);
        expect(result.current.queries).not.toContain(`query-${MAX_RECENT_SEARCHES - 1}`);
    });

    it('keeps a query recorded BEFORE hydration resolved, merged in front of the stored history', async () => {
        // The race: the async read is still pending when the container commits its first query (e.g. a
        // shared `?query=…` link). Neither side may win outright — the session entry must survive AND the
        // stored history must not be clobbered.
        const store = makeFakeStore(serializeRecentSearches(['older']));
        let resolveRead: (value: string | null) => void = () => undefined;
        const gatedStore: RecentSearchStore = {
            getItem: () =>
                new Promise<string | null>((resolve) => {
                    resolveRead = resolve;
                }),
            setItem: store.setItem,
            removeItem: store.removeItem,
        };

        const { result } = renderHook(() => useRecentSearches('pasta', gatedStore, SUBJECT));

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));
        // Nothing may be written while the stored history is still unknown.
        expect(store.writes).toHaveLength(0);

        await act(async () => {
            resolveRead(serializeRecentSearches(['older']));
        });

        expect(result.current.queries).toEqual(['pasta', 'older']);
        await waitFor(() => expect(store.value).toBe(serializeRecentSearches(['pasta', 'older'])));
    });
});

describe('useRecentSearches — clear', () => {
    it('empties the history and persists the empty list', async () => {
        const store = makeFakeStore(serializeRecentSearches(['pasta', 'risotto']));
        const { result } = renderHook(() => useRecentSearches('', store, SUBJECT));

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        act(() => {
            result.current.clear();
        });

        expect(result.current.queries).toEqual([]);
        await waitFor(() => expect(store.value).toBe(serializeRecentSearches([])));
    });
});

describe('useRecentSearches — persistence across a reload', () => {
    it('a recorded query is still there after a remount reading the same store', async () => {
        const store = makeFakeStore();
        const first = renderHook(() => useRecentSearches('lamb tagine', store, SUBJECT));

        await waitFor(() => expect(first.result.current.queries).toEqual(['lamb tagine']));
        await waitFor(() => expect(store.value).toBe(serializeRecentSearches(['lamb tagine'])));
        first.unmount();

        const second = renderHook(() => useRecentSearches('', store, SUBJECT));

        await waitFor(() => expect(second.result.current.queries).toEqual(['lamb tagine']));
    });
});

describe('useRecentSearches — a failing store', () => {
    it('degrades to an empty history when the read rejects', async () => {
        const store: RecentSearchStore = {
            getItem: () => Promise.reject(new Error('storage unavailable')),
            setItem: vi.fn().mockResolvedValue(undefined),
            removeItem: vi.fn().mockResolvedValue(undefined),
        };

        const { result } = renderHook(() => useRecentSearches('pasta', store, SUBJECT));

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));
    });

    it('keeps working when the write rejects', async () => {
        const setItem = vi.fn().mockRejectedValue(new Error('quota exceeded'));
        const store: RecentSearchStore = { getItem: async () => null, setItem, removeItem: async () => undefined };

        const { result } = renderHook(() => useRecentSearches('pasta', store, SUBJECT));

        await waitFor(() => expect(setItem).toHaveBeenCalled());
        expect(result.current.queries).toEqual(['pasta']);
    });
});

/** A keyed in-memory store, the shape both real adapters have, so two users can share ONE device. */
function makeKeyedStore(initial: Record<string, string> = {}): RecentSearchStore & {
    readonly data: Map<string, string>;
    readonly writes: { readonly key: string; readonly value: string }[];
} {
    const data = new Map(Object.entries(initial));
    const writes: { key: string; value: string }[] = [];

    return {
        data,
        writes,
        getItem: async (key) => data.get(key) ?? null,
        setItem: async (key, value) => {
            writes.push({ key, value });
            data.set(key, value);
        },
        removeItem: async (key) => {
            data.delete(key);
        },
    };
}

/**
 * Owner ruling 2026-10-17 (`docs/design/uiOverhaul/ownerDecisions.md`): recent searches stay on the device, per signed-in
 * user. Every case here would pass on the old unscoped store only by showing one user another's searches.
 */
describe('useRecentSearches: scoped to the signed-in user', () => {
    const A = recentSearchesKeyFor('user_a');
    const B = recentSearchesKeyFor('user_b');

    it('⛔ shows only the signed-in user`s history, never another user`s on the same device', async () => {
        const store = makeKeyedStore({
            [A]: serializeRecentSearches(['a-soup']),
            [B]: serializeRecentSearches(['b-stew']),
        });

        const { result } = renderHook(() => useRecentSearches('', store, 'user_b'));

        await waitFor(() => expect(result.current.queries).toEqual(['b-stew']));
    });

    it('⛔ switching user drops the first user`s entries at once and never writes them under the second', async () => {
        const store = makeKeyedStore({ [A]: serializeRecentSearches(['a-soup']) });
        const { result, rerender } = renderHook(({ subject }) => useRecentSearches('', store, subject), {
            initialProps: { subject: 'user_a' as string | null },
        });
        await waitFor(() => expect(result.current.queries).toEqual(['a-soup']));

        rerender({ subject: 'user_b' });

        // The very render after the switch must not show A's list.
        expect(result.current.queries).toEqual([]);
        await waitFor(() => expect(store.data.get(B)).toBe(serializeRecentSearches([])));
        expect(store.writes.filter((w) => w.key === B).every((w) => !w.value.includes('a-soup'))).toBe(true);
        expect(store.data.get(A)).toBe(serializeRecentSearches(['a-soup']));
    });

    it('⛔ a search typed as user A is stored under A only', async () => {
        const store = makeKeyedStore();
        const { result } = renderHook(() => useRecentSearches('ramen', store, 'user_a'));

        await waitFor(() => expect(result.current.queries).toEqual(['ramen']));
        await waitFor(() => expect(store.data.get(A)).toBe(serializeRecentSearches(['ramen'])));
        expect(store.data.has(B)).toBe(false);
    });

    it('⛔ reads and writes nothing while nobody is signed in (null)', async () => {
        const store = makeKeyedStore({ [A]: serializeRecentSearches(['a-soup']) });
        const { result } = renderHook(() => useRecentSearches('ramen', store, null));

        await waitFor(() => expect(result.current.queries).toEqual(['ramen']));
        expect(store.writes).toEqual([]);
    });

    it('⛔ the subject arriving after Clerk loads hydrates and does NOT overwrite the stored list', async () => {
        const store = makeKeyedStore({ [A]: serializeRecentSearches(['a-soup', 'a-pie']) });
        const { result, rerender } = renderHook(({ subject }) => useRecentSearches('', store, subject), {
            initialProps: { subject: undefined as string | null | undefined },
        });
        expect(store.writes).toEqual([]);

        rerender({ subject: 'user_a' });

        await waitFor(() => expect(result.current.queries).toEqual(['a-soup', 'a-pie']));
        expect(store.data.get(A)).toBe(serializeRecentSearches(['a-soup', 'a-pie']));
    });

    it('⛔ signing out empties what is shown', async () => {
        const store = makeKeyedStore({ [A]: serializeRecentSearches(['a-soup']) });
        const { result, rerender } = renderHook(({ subject }) => useRecentSearches('', store, subject), {
            initialProps: { subject: 'user_a' as string | null },
        });
        await waitFor(() => expect(result.current.queries).toEqual(['a-soup']));

        rerender({ subject: null });

        expect(result.current.queries).toEqual([]);
    });

    it('⛔ the earlier unscoped payload is never read', async () => {
        const store = makeKeyedStore({ 'commise.recipes.recentSearches.v1': serializeRecentSearches(['earlier']) });

        const { result } = renderHook(() => useRecentSearches('', store, 'user_a'));

        await waitFor(() => expect(store.writes.length).toBeGreaterThan(0));
        expect(result.current.queries).toEqual([]);
    });
});
