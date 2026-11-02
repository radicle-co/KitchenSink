/**
 * @module @commise/features-recipes/list — the Recipes library read as a STATE, not a boundary.
 *
 * The screen reads the library without suspending, so the frame (title, segments, search) stays mounted in every state
 * and typing into the field survives a pending read or a failed one. It follows ADR-0079's precedent: the slot reads a
 * pending, failed or settled value and switches over it exhaustively.
 *
 * @pattern State — a discriminated union switched exhaustively (the TypeScript form of the pattern)
 */

/** What the library read says, in the three states the screen draws. */
export type LibraryReading<Data> =
    { readonly kind: 'pending' } | { readonly kind: 'failed' } | { readonly kind: 'settled'; readonly data: Data };

/** The part of a TanStack query result the reading is derived from. */
export interface LibraryReadingSource<Data = unknown> {
    readonly status: 'pending' | 'error' | 'success';
    readonly data: Data | undefined;
}

/**
 * Derive the reading. Anything on screen wins: a refresh that failed over a library the cook is looking at is still
 * `settled` (the refresh notice speaks), and so is a new sort loading over the previous library (placeholder data).
 * `pending` covers a read parked offline too; the offline copy decorates it.
 *
 * @param source - The query's `status` and `data`.
 * @returns The reading. Pure.
 */
export function libraryReadingOf<Data>(source: LibraryReadingSource<Data>): LibraryReading<Data> {
    if (source.data !== undefined) {
        return { kind: 'settled', data: source.data };
    }

    return source.status === 'error' ? { kind: 'failed' } : { kind: 'pending' };
}
