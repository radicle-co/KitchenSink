/**
 * `syncNoticeState` — turning queue facts into what the cook is told.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION. The owner's bar: "As long as we are clearly notifying a user that they
 * are offline and what data/recipe hasn't been synced with the servers, then that should be good."
 */
import { describe, expect, it } from 'vitest';

import { recoveringOf, syncNoticeState, type SyncFacts } from '../syncNoticeState.js';

const COPY = {
    offlineTitle: 'You’re offline',
    offlineBodyNone: 'Anything you change is saved here.',
    offlineBodyOne: '{count} change is saved here.',
    offlineBodyOther: '{count} changes are saved here.',
    syncingTitle: 'Back online',
    syncingBodyOne: 'Syncing {count} change…',
    syncingBodyOther: 'Syncing {count} changes…',
};

/** Online, nothing queued, never offline: the quiet baseline each case moves one fact from. */
const facts: SyncFacts = { offline: false, pendingCount: 0, parkedCount: 0, wasOffline: false };

describe('syncNoticeState', () => {
    it('shows nothing when online with an empty queue', () => {
        expect(syncNoticeState({ ...facts, offline: false, pendingCount: 0 }, COPY).kind).toBe('hidden');
    });

    it('⛔ says so while offline, even with nothing queued', () => {
        const state = syncNoticeState({ ...facts, offline: true, pendingCount: 0 }, COPY);

        expect(state).toStrictEqual({
            kind: 'offline',
            title: 'You’re offline',
            body: 'Anything you change is saved here.',
        });
    });

    it('⛔ names HOW MANY changes are unsynced — the owner’s explicit requirement', () => {
        expect(syncNoticeState({ ...facts, offline: true, pendingCount: 1 }, COPY)).toStrictEqual({
            kind: 'offline',
            title: 'You\u2019re offline',
            body: '1 change is saved here.',
        });
        expect(syncNoticeState({ ...facts, offline: true, pendingCount: 3 }, COPY)).toStrictEqual({
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
        const state = syncNoticeState({ ...facts, offline: false, pendingCount: 2, wasOffline: true }, COPY);

        expect(state).toStrictEqual({ kind: 'syncing', title: 'Back online', body: 'Syncing 2 changes…' });
    });

    it('goes quiet once the queue is empty again', () => {
        expect(syncNoticeState({ ...facts, offline: false, pendingCount: 0 }, COPY).kind).toBe('hidden');
    });
});

/**
 * E18: the notice said "Back online. Syncing 1 change…" for the whole of a conflict and for any ordinary queued write,
 * because "online with a queue" was read as "just reconnected", and because a PARKED record (a 409 waiting for the cook)
 * was counted as syncing. "Back online" is only true after being offline, and a parked write is not in flight.
 */
describe('syncNoticeState — back online (E18)', () => {
    it('⛔ stays quiet for a write that is merely in flight: the device was never offline', () => {
        expect(syncNoticeState({ ...facts, pendingCount: 1 }, COPY).kind).toBe('hidden');
    });

    it('⛔ stays quiet for a parked write, which waits for the cook and syncs nothing', () => {
        expect(syncNoticeState({ ...facts, pendingCount: 1, parkedCount: 1, wasOffline: true }, COPY).kind).toBe(
            'hidden',
        );
    });

    it('counts only the writes that are really going out', () => {
        const state = syncNoticeState({ ...facts, pendingCount: 3, parkedCount: 1, wasOffline: true }, COPY);

        expect(state).toStrictEqual({ kind: 'syncing', title: 'Back online', body: 'Syncing 2 changes…' });
    });

    it('⛔ still counts a parked write as unsynced while offline: it is on the device and unsent', () => {
        const state = syncNoticeState({ ...facts, offline: true, pendingCount: 2, parkedCount: 1 }, COPY);

        expect(state).toStrictEqual({ kind: 'offline', title: 'You’re offline', body: '2 changes are saved here.' });
    });
});

describe('recoveringOf', () => {
    it('is true while offline, and stays true after reconnecting until the writes have gone', () => {
        expect(recoveringOf(false, { offline: true, unsynced: 0 })).toBe(true);
        expect(recoveringOf(true, { offline: false, unsynced: 2 })).toBe(true);
    });

    it('ends once the writes that waited have gone', () => {
        expect(recoveringOf(true, { offline: false, unsynced: 0 })).toBe(false);
    });

    it('never starts without an offline spell', () => {
        expect(recoveringOf(false, { offline: false, unsynced: 4 })).toBe(false);
    });
});
