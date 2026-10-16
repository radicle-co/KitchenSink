/**
 * {@link SyncNoticeHost} — the notice's wiring (E18). "Back online" needs a past offline spell, which the host keeps; a
 * parked record is not counted as syncing. The mapping itself is `syncNoticeState`'s, covered by its own suite.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncNoticeHost } from '../SyncNoticeHost.js';

const world = vi.hoisted(() => ({
    offline: false,
    pendingCount: 0,
    failures: [] as readonly unknown[],
    unreadableCount: 0,
}));

vi.mock('../useIsOffline.js', () => ({ useIsOffline: () => world.offline }));
vi.mock('../syncProvider.js', () => ({
    useSyncQueue: () => ({
        pendingCount: world.pendingCount,
        failures: world.failures,
        unreadableCount: world.unreadableCount,
    }),
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
    unreadableTitle: 'Some work on this device couldn’t be opened',
    unreadableBody: 'We can’t show it or send it, and it can’t be recovered.',
    unreadableDismiss: 'Dismiss',
};

afterEach(() => {
    cleanup();
    world.offline = false;
    world.pendingCount = 0;
    world.failures = [];
    world.unreadableCount = 0;
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

/**
 * ⛔ THE UNREADABLE-WORK NOTICE (`specSharedSystem.md` §17). Shown while the session's set-asides exceed the count at which
 * the cook dismissed; the host keeps that count as derived state, so a reload that set nothing aside shows nothing.
 */
describe('SyncNoticeHost — unreadable work', () => {
    const TITLE = 'Some work on this device couldn’t be opened';

    it('says nothing when nothing was set aside this load', () => {
        show();

        expect(screen.queryByText(TITLE)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('⛔ shows the card, with no count and a Dismiss, when this load set work aside', () => {
        world.unreadableCount = 1;
        show();

        expect(screen.getByText(TITLE)).toBeTruthy();
        expect(screen.getByText('We can’t show it or send it, and it can’t be recovered.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });

    it('⛔ Dismiss hides it, and it stays hidden across re-renders with the same count', () => {
        world.unreadableCount = 1;
        const view = show();

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        view.rerender(<SyncNoticeHost copy={copy} />);

        expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('⛔ a later set-aside in the same session shows it again', () => {
        world.unreadableCount = 1;
        const view = show();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        world.unreadableCount = 2;
        view.rerender(<SyncNoticeHost copy={copy} />);

        expect(screen.getByText(TITLE)).toBeTruthy();
    });

    it('⛔ a session-end reset does not leave the old dismissal hiding the next session`s first set-aside', () => {
        world.unreadableCount = 2;
        const view = show();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        world.unreadableCount = 0;
        view.rerender(<SyncNoticeHost copy={copy} />);
        world.unreadableCount = 1;
        view.rerender(<SyncNoticeHost copy={copy} />);

        expect(screen.getByText(TITLE)).toBeTruthy();
    });

    it('⛔ offline plus a set-aside renders both, the unreadable card ABOVE the sync notice', () => {
        world.unreadableCount = 1;
        world.offline = true;
        show();

        const unreadable = screen.getByText(TITLE);
        const offline = screen.getByText('You’re offline');

        expect(unreadable.compareDocumentPosition(offline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('⛔ the sync notice still offers no control while the unreadable one does', () => {
        world.offline = true;
        show();

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('does not move focus when the card arrives', () => {
        const view = show();

        act(() => {
            world.unreadableCount = 1;
            view.rerender(<SyncNoticeHost copy={copy} />);
        });

        expect(document.activeElement).toBe(document.body);
    });
});
