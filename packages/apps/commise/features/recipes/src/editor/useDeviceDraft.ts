'use client';

/**
 * @module @commise/features-recipes/editor — the editor's device draft, read once per OPENING of the editor, as a
 * suspense read under the container's own read boundary (ADR-0057's memento; the seed `useRecipeEditor` captures once).
 *
 * ⛔ One read per opening, never a cached one. The editor writes the draft as the cook types and discards it once the
 * server holds it, so a draft cached by an earlier opening is stale by the next one: seeded from it, a reopened editor
 * would bring back changes the cook already saved. So the key carries the OPENING (`nextEditorOpening`, minted by the
 * container OUTSIDE the boundary, because a component that suspends before it first commits keeps no state), and the
 * entry is collected as soon as no opening reads it.
 *
 * ⛔ A device read, not a network one (`networkMode: 'always'`): TanStack would otherwise pause it offline, and an
 * editor opened offline would never open. And it never fails: an unreadable draft opens the server's copy (the store has
 * already quarantined the bytes), so the boundary's error state is the RECIPE read's alone.
 *
 * @pattern Proxy — the draft store's `load` behind TanStack's suspense cache, keyed per opening
 */
import { useSuspenseQuery } from '@tanstack/react-query';

import type { DraftMemento, DraftStore } from './draftStore.js';

/** What one read of the device draft names. */
export interface DeviceDraftRead {
    /** The signed-in cook's draft store (`draftStoreFor`). */
    readonly drafts: DraftStore;
    /** The cook, whose store it is: part of the key, so one cook never reads another's cached read. */
    readonly subject: string;
    /** The recipe's ref (its local ref before the create, its server id after), or `undefined` for a blank new recipe. */
    readonly ref: string | undefined;
    /** This opening of the editor (`nextEditorOpening`). */
    readonly opening: number;
}

/** The openings minted in this process: each one's draft read is its own. */
let openings = 0;

/**
 * A new opening of the editor, for {@link DeviceDraftRead.opening}. Called once per opening, by a component that does
 * not suspend (a `useState` initializer outside the read boundary).
 *
 * @returns A number no earlier opening had. @sideEffect Advances the process's counter.
 */
export function nextEditorOpening(): number {
    openings += 1;

    return openings;
}

/**
 * The device draft this opening of the editor is seeded from. Suspends until it is read.
 *
 * @param read - The store, the cook, the recipe and the opening.
 * @returns The draft, or `undefined` when there is none (or it could not be read).
 * @sideEffect Reads the device store, once per opening.
 */
export function useDeviceDraft(read: DeviceDraftRead): DraftMemento | undefined {
    const { drafts, subject, ref, opening } = read;
    const { data } = useSuspenseQuery({
        queryKey: ['editor', 'deviceDraft', subject, ref ?? null, opening],
        // TanStack refuses `undefined` data, so "no draft" is `null` here and `undefined` to the caller.
        queryFn: async (): Promise<DraftMemento | null> =>
            ref === undefined ? null : ((await drafts.load(ref).catch(() => undefined)) ?? null),
        networkMode: 'always',
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    return data ?? undefined;
}
