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
    RECENT_SEARCHES_STORAGE_KEY,
    serializeRecentSearches,
    type RecentSearchStore,
} from '../../discovery/recentSearches.js';
import { useRecentSearches } from '../useRecentSearches.js';

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
    };
}

describe('useRecentSearches — hydration', () => {
    it('starts empty and hydrates the stored history from the port', async () => {
        const store = makeFakeStore(serializeRecentSearches(['pasta', 'risotto']));

        const { result } = renderHook(() => useRecentSearches('', store));

        expect(result.current.queries).toEqual([]);
        await waitFor(() => expect(result.current.queries).toEqual(['pasta', 'risotto']));
        expect(store.reads).toEqual([RECENT_SEARCHES_STORAGE_KEY]);
    });

    it('hydrates to an empty history when nothing is stored', async () => {
        const store = makeFakeStore(null);

        const { result } = renderHook(() => useRecentSearches('', store));

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

        const { result } = renderHook(({ query }) => useRecentSearches(query, store), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(store.reads).toHaveLength(1));
        expect(result.current.queries).toEqual([]);

        // Nothing was committed yet — an empty field must never write a history entry.
        expect(store.writes.some((write) => write.includes('pasta'))).toBe(false);
    });

    it.each([[''], ['   ']])('records NOTHING for a blank committed query (%j)', async (blank) => {
        const store = makeFakeStore();

        const { result } = renderHook(() => useRecentSearches(blank, store));

        await waitFor(() => expect(store.reads).toHaveLength(1));
        expect(result.current.queries).toEqual([]);
    });

    it('records each committed query, newest first', async () => {
        const store = makeFakeStore();
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store), {
            initialProps: { query: 'pasta' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));

        rerender({ query: 'risotto' });

        await waitFor(() => expect(result.current.queries).toEqual(['risotto', 'pasta']));
        expect(store.value).toBe(serializeRecentSearches(['risotto', 'pasta']));
    });

    it('de-duplicates case-insensitively rather than growing the list', async () => {
        const store = makeFakeStore(serializeRecentSearches(['pasta', 'risotto']));
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store), {
            initialProps: { query: '' },
        });

        await waitFor(() => expect(result.current.queries).toEqual(['pasta', 'risotto']));

        rerender({ query: 'PASTA' });

        await waitFor(() => expect(result.current.queries).toEqual(['PASTA', 'risotto']));
    });

    it('caps the history, evicting the oldest entry', async () => {
        const stored = Array.from({ length: MAX_RECENT_SEARCHES }, (_unused, index) => `query-${index}`);
        const store = makeFakeStore(serializeRecentSearches(stored));
        const { result, rerender } = renderHook(({ query }) => useRecentSearches(query, store), {
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
        };

        const { result } = renderHook(() => useRecentSearches('pasta', gatedStore));

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
        const { result } = renderHook(() => useRecentSearches('', store));

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
        const first = renderHook(() => useRecentSearches('lamb tagine', store));

        await waitFor(() => expect(first.result.current.queries).toEqual(['lamb tagine']));
        await waitFor(() => expect(store.value).toBe(serializeRecentSearches(['lamb tagine'])));
        first.unmount();

        const second = renderHook(() => useRecentSearches('', store));

        await waitFor(() => expect(second.result.current.queries).toEqual(['lamb tagine']));
    });
});

describe('useRecentSearches — a failing store', () => {
    it('degrades to an empty history when the read rejects', async () => {
        const store: RecentSearchStore = {
            getItem: () => Promise.reject(new Error('storage unavailable')),
            setItem: vi.fn().mockResolvedValue(undefined),
        };

        const { result } = renderHook(() => useRecentSearches('pasta', store));

        await waitFor(() => expect(result.current.queries).toEqual(['pasta']));
    });

    it('keeps working when the write rejects', async () => {
        const setItem = vi.fn().mockRejectedValue(new Error('quota exceeded'));
        const store: RecentSearchStore = { getItem: async () => null, setItem };

        const { result } = renderHook(() => useRecentSearches('pasta', store));

        await waitFor(() => expect(setItem).toHaveBeenCalled());
        expect(result.current.queries).toEqual(['pasta']);
    });
});
