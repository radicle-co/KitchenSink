/**
 * @module @commise/features-recipes/hooks — which of four states a library read is in, judged from the query cache
 * (`docs/design/uiOverhaul/buildSpec.md` §3.4). The floating create button and My recipes' search read it.
 *
 * | state         | the cache holds                                           | floating create button |
 * | ------------- | --------------------------------------------------------- | ---------------------- |
 * | `populated`   | a settled read with recipes                               | shown                  |
 * | `empty`       | a settled read of none (the first run)                    | absent: start buttons  |
 * | `loading`     | no settled read, and the first fetch is in flight         | absent (never appears) |
 * | `unreachable` | no settled read, and the fetch is paused (offline)/failed | shown                  |
 *
 * A cached read always wins: a refetch in flight, paused or failed does not change the verdict (a warm screen is judged
 * from its first frame). The verdict comes from the LATEST settled read anywhere in the read's FAMILY, so a sort change
 * (a new key, fetching) does not blink the button; the screen's OWN read only decides loading vs unreachable when
 * nothing in the family has settled. An own read with no cache entry yet counts as `loading`: the frame renders before
 * its boundary creates the read.
 *
 * @pattern Specification — a pure predicate over plain snapshots, so every state is testable without a query client
 */

/** What a read caches: chunks or pages, the first of which says how many there are, or one page that says so. */
type CachedRead = { readonly pages: readonly { readonly total: number }[] } | { readonly total: number };

/** The four states of a library read. */
export type LibraryCacheState = 'populated' | 'empty' | 'loading' | 'unreachable';

/** The parts of a cached query {@link libraryStateOf} judges. A structural subset of TanStack's `QueryState`. */
export interface ReadSnapshot {
    readonly data: CachedRead | undefined;
    readonly dataUpdatedAt: number;
    readonly status: 'pending' | 'error' | 'success';
    readonly fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * How many recipes (or collections) a settled read says there are. Pure.
 *
 * @param data - A cache entry that holds data.
 * @returns The envelope's `total`.
 */
function totalOf(data: CachedRead): number {
    return 'pages' in data ? (data.pages[0]?.total ?? 0) : data.total;
}

/**
 * The state of a library, from the cache. Pure.
 *
 * @param family - Every read of the library, whatever its sort: the verdict comes from the latest settled one.
 * @param own - The screen's own read, or `undefined` while it has no cache entry.
 * @returns The state.
 */
export function libraryStateOf(family: readonly ReadSnapshot[], own: ReadSnapshot | undefined): LibraryCacheState {
    let latest: { readonly at: number; readonly total: number } | undefined;

    for (const read of [...family, ...(own === undefined ? [] : [own])]) {
        if (read.data === undefined) {
            continue;
        }

        const candidate = { at: read.dataUpdatedAt, total: totalOf(read.data) };
        // On a tie of time the read with recipes wins: a button that stays is the safe error.
        const wins =
            latest === undefined ||
            candidate.at > latest.at ||
            (candidate.at === latest.at && candidate.total > latest.total);

        if (wins) {
            latest = candidate;
        }
    }

    if (latest !== undefined) {
        return latest.total > 0 ? 'populated' : 'empty';
    }

    if (own !== undefined && (own.status === 'error' || own.fetchStatus === 'paused')) {
        return 'unreachable';
    }

    return 'loading';
}

/**
 * Whether the floating create button yields its place on Home and Collections: it never appears while the first fetch
 * is in flight (so it cannot vanish), and gives way to the first-run start buttons. Pure.
 *
 * @param state - The library's state.
 * @returns `true` for `loading` and `empty`.
 */
export function createEntryYields(state: LibraryCacheState): boolean {
    return state === 'loading' || state === 'empty';
}
