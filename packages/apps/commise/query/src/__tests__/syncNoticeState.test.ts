/**
 * `syncNoticeState` — turning queue facts into what the cook is told.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION. The owner's bar: "As long as we are clearly notifying a user that they
 * are offline and what data/recipe hasn't been synced with the servers, then that should be good."
 */
import { describe, expect, it } from 'vitest';

import { syncNoticeState } from '../syncNoticeState.js';

const COPY = {
    offlineTitle: 'You’re offline',
    offlineBodyNone: 'Anything you change is saved here.',
    offlineBodyOne: '{count} change is saved here.',
    offlineBodyOther: '{count} changes are saved here.',
    syncingTitle: 'Back online',
    syncingBodyOne: 'Syncing {count} change…',
    syncingBodyOther: 'Syncing {count} changes…',
};

describe('syncNoticeState', () => {
    it('shows nothing when online with an empty queue', () => {
        expect(syncNoticeState({ offline: false, pendingCount: 0 }, COPY).kind).toBe('hidden');
    });

    it('⛔ says so while offline, even with nothing queued', () => {
        const state = syncNoticeState({ offline: true, pendingCount: 0 }, COPY);

        expect(state).toStrictEqual({
            kind: 'offline',
            title: 'You’re offline',
            body: 'Anything you change is saved here.',
        });
    });

    it('⛔ names HOW MANY changes are unsynced — the owner’s explicit requirement', () => {
        expect(syncNoticeState({ offline: true, pendingCount: 1 }, COPY)).toStrictEqual({
            kind: 'offline',
            title: 'You\u2019re offline',
            body: '1 change is saved here.',
        });
        expect(syncNoticeState({ offline: true, pendingCount: 3 }, COPY)).toStrictEqual({
            kind: 'offline',
            title: 'You\u2019re offline',
            body: '3 changes are saved here.',
        });
    });

    /**
     * ⛔ RECONNECTING IS ITS OWN STATE. Without it the notice would vanish the instant connectivity returns,
     * while the writes are still in flight — telling the cook everything is synced before it is.
     */
    it('⛔ reports the drain after reconnecting, rather than vanishing early', () => {
        const state = syncNoticeState({ offline: false, pendingCount: 2 }, COPY);

        expect(state).toStrictEqual({ kind: 'syncing', title: 'Back online', body: 'Syncing 2 changes…' });
    });

    it('goes quiet once the queue is empty again', () => {
        expect(syncNoticeState({ offline: false, pendingCount: 0 }, COPY).kind).toBe('hidden');
    });
});
