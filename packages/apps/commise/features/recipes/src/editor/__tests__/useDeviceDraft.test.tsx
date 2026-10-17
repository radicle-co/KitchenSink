/**
 * {@link useDeviceDraft} — the editor's device draft read once per opening, as a suspense read under the container's
 * own boundary (finding 12 of the 2026-10-09 review: it was an effect with a `live` flag, copied byte for byte into both
 * containers).
 *
 * Four traps, one case each: TanStack refuses `undefined` data; a load that rejects must open the server's copy, not
 * the error boundary; a cached draft must never seed a LATER opening, which would bring back changes the cook saved
 * since; and the read is of the DEVICE, so it must not pause offline the way a network read does.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftMemento, DraftStore } from '../draftStore.js';
import { useDeviceDraft, type DeviceDraftRead } from '../useDeviceDraft.js';

const MEMENTO = (description: string): DraftMemento => ({
    recipeRef: 'rec_1',
    baseVersion: 3,
    values: {
        title: 'Soup',
        description,
        cuisine: '',
        tags: [],
        dietaryFlags: [],
        servings: 2,
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        visibility: 'public',
        ingredients: [],
        steps: [],
    },
    pendingRebinds: [],
    savedAt: '2026-10-09T10:00:00.000Z',
});

function storeLoading(load: DraftStore['load']): DraftStore {
    return {
        load: vi.fn(load),
        save: async () => undefined,
        discard: async () => undefined,
        adopt: async () => undefined,
        clear: async () => undefined,
    };
}

function read(read: DeviceDraftRead, client = new QueryClient()) {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>
            <Suspense fallback={null}>{children}</Suspense>
        </QueryClientProvider>
    );

    return {
        ...renderHook((props: DeviceDraftRead) => useDeviceDraft(props), { initialProps: read, wrapper }),
        client,
    };
}

afterEach(() => {
    onlineManager.setOnline(true);
});

describe('useDeviceDraft', () => {
    it('reads the recipe`s draft', async () => {
        const drafts = storeLoading(async () => MEMENTO('Kept.'));
        const { result } = read({ drafts, subject: 'user_cook', ref: 'rec_1', opening: 1 });

        await waitFor(() => expect(result.current).toEqual(MEMENTO('Kept.')));
        expect(drafts.load).toHaveBeenCalledWith('rec_1');
    });

    it('has none for a recipe with no draft, and reads nothing for a blank new recipe', async () => {
        const none = storeLoading(async () => undefined);
        const blank = storeLoading(async () => MEMENTO('never'));

        const kept = read({ drafts: none, subject: 'user_cook', ref: 'rec_1', opening: 1 });
        const fresh = read({ drafts: blank, subject: 'user_cook', ref: undefined, opening: 1 });

        await waitFor(() => expect(none.load).toHaveBeenCalled());
        await waitFor(() => expect(fresh.result.current).toBeUndefined());
        expect(kept.result.current).toBeUndefined();
        expect(blank.load).not.toHaveBeenCalled();
    });

    it('⛔ opens the server`s copy when the draft cannot be read: the store has quarantined the bytes', async () => {
        const drafts = storeLoading(async () => {
            throw new Error('unreadable');
        });
        const { result } = read({ drafts, subject: 'user_cook', ref: 'rec_1', opening: 1 });

        await waitFor(() => expect(drafts.load).toHaveBeenCalled());
        await waitFor(() => expect(result.current).toBeUndefined());
    });

    it('⛔ reads the device offline: it is not a network read, and an editor opened offline must open', async () => {
        onlineManager.setOnline(false);
        const drafts = storeLoading(async () => MEMENTO('Offline.'));
        const { result } = read({ drafts, subject: 'user_cook', ref: 'rec_1', opening: 1 });

        await waitFor(() => expect(result.current).toEqual(MEMENTO('Offline.')));
    });

    it('⛔ a later opening reads again, never the draft an earlier opening cached', async () => {
        let stored = MEMENTO('Before Save changes.');
        const drafts = storeLoading(async () => stored);
        const client = new QueryClient();
        const first = read({ drafts, subject: 'user_cook', ref: 'rec_1', opening: 1 }, client);

        await waitFor(() => expect(first.result.current).toEqual(MEMENTO('Before Save changes.')));
        first.unmount();
        stored = MEMENTO('After.');

        const second = read({ drafts, subject: 'user_cook', ref: 'rec_1', opening: 2 }, client);

        await waitFor(() => expect(second.result.current).toEqual(MEMENTO('After.')));
    });
});
