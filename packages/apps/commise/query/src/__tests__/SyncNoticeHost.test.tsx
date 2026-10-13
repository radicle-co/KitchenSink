/**
 * {@link SyncNoticeHost} — the notice's wiring (E18). "Back online" needs a past offline spell, which the host keeps; a
 * parked record is not counted as syncing. The mapping itself is `syncNoticeState`'s, covered by its own suite.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncNoticeHost } from '../SyncNoticeHost.js';

const world = vi.hoisted(() => ({
    offline: false,
    pendingCount: 0,
    failures: [] as readonly unknown[],
}));

vi.mock('../useIsOffline.js', () => ({ useIsOffline: () => world.offline }));
vi.mock('../syncProvider.js', () => ({
    useSyncQueue: () => ({ pendingCount: world.pendingCount, failures: world.failures }),
}));

const copy = {
    regionLabel: 'Sync status',
    offlineTitle: 'You’re offline',
    offlineBodyNone: 'Saved here.',
    offlineBodyOne: '{count} change is saved here.',
    offlineBodyOther: '{count} changes are saved here.',
    syncingTitle: 'Back online',
    syncingBodyOne: 'Syncing {count} change…',
    syncingBodyOther: 'Syncing {count} changes…',
};

afterEach(() => {
    cleanup();
    world.offline = false;
    world.pendingCount = 0;
    world.failures = [];
});

function show(): ReturnType<typeof render> {
    return render(<SyncNoticeHost copy={copy} />);
}

describe('SyncNoticeHost', () => {
    it('⛔ says nothing for a write in flight on a connection that never dropped', () => {
        world.pendingCount = 1;
        show();

        expect(screen.queryByText('Back online')).toBeNull();
    });

    it('⛔ says nothing for a parked write: it waits for the cook, it does not sync', () => {
        world.pendingCount = 1;
        world.failures = [{}];
        show();

        expect(screen.queryByText('Back online')).toBeNull();
    });

    it('says "Back online" after an offline spell while its writes go out, then goes quiet when they have gone', () => {
        world.offline = true;
        world.pendingCount = 2;
        const view = show();
        expect(screen.getByText('You’re offline')).toBeTruthy();

        world.offline = false;
        view.rerender(<SyncNoticeHost copy={copy} />);
        expect(screen.getByText('Back online')).toBeTruthy();
        expect(screen.getByText('Syncing 2 changes…')).toBeTruthy();

        world.pendingCount = 0;
        view.rerender(<SyncNoticeHost copy={copy} />);
        expect(screen.queryByText('Back online')).toBeNull();

        // A later write on the same connection is not a reconnection.
        world.pendingCount = 1;
        view.rerender(<SyncNoticeHost copy={copy} />);
        expect(screen.queryByText('Back online')).toBeNull();
    });
});
