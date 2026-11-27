/**
 * {@link SyncNoticeAnnouncement}: the text the open windows speak for the page's offline notice. It shares the host's
 * Specification, so the words are the notice's own, and only the cooking form speaks.
 */
import { WindowAnnouncementContext } from '@commise/ui/snackbar';
import { cleanup, render, screen } from '@testing-library/react';
import { useContext, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeSyncNoticeCopy } from '../__fixtures__/makeSyncNoticeCopy.js';
import { SyncNoticeAnnouncement } from '../SyncNoticeHost.js';

const world = vi.hoisted(() => ({ offline: false }));

vi.mock('../useIsOffline.js', () => ({ useIsOffline: () => world.offline }));
vi.mock('../syncProvider.js', () => ({
    useSyncQueue: () => ({ pendingCount: 0, failures: [], unreadableCount: 0 }),
}));

const copy = makeSyncNoticeCopy();

afterEach(() => {
    cleanup();
    world.offline = false;
});

/** A window's side of the channel: it prints what it is handed. */
function Reader(): JSX.Element {
    const { text, speaks } = useContext(WindowAnnouncementContext);

    return <output>{`${speaks ? 'speaks' : 'silent'}:${text}`}</output>;
}

const handed = (form: 'app' | 'cooking'): string => {
    render(
        <SyncNoticeAnnouncement copy={copy} form={form}>
            <Reader />
        </SyncNoticeAnnouncement>,
    );

    return screen.getByRole('status').textContent;
};

describe('SyncNoticeAnnouncement', () => {
    it('hands the windows the notice title in the cooking form while offline', () => {
        world.offline = true;

        // Kills: no provider, and a title that is not the notice's own.
        expect(handed('cooking')).toBe('speaks:You’re offline');
    });

    it('hands the windows nothing in the cooking form while online', () => {
        // Kills: a title held after the connection came back.
        expect(handed('cooking')).toBe('speaks:');
    });

    it('hands the windows the title but no leave to speak it in the app form, even offline', () => {
        world.offline = true;

        // Kills: the app form announcing, and a form that hides the title (a change of form would then look like news).
        expect(handed('app')).toBe('silent:You’re offline');
    });
});
