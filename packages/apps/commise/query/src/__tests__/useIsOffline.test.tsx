/**
 * `useIsOffline` — the ONE connectivity reader for both apps.
 *
 * Drives TanStack's real `onlineManager` singleton rather than a double: the hook's whole job is to be a
 * React snapshot of that singleton, so a mocked one would assert the mock.
 */
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useIsOffline } from '../useIsOffline.js';

/** Renders the hook's value as text, so the assertion reads what a component would actually see. */
function Probe(): ReactElement {
    return <span>{useIsOffline() ? 'offline' : 'online'}</span>;
}

afterEach(() => {
    // ⚠️ EXPLICIT — this package's vitest config does not enable RTL's auto-cleanup, so without it the first
    // test's probe stays mounted AND stays subscribed, and the next `getByText` finds two.
    cleanup();
    onlineManager.setOnline(true);
});

describe('useIsOffline', () => {
    it('reports the current connectivity', () => {
        onlineManager.setOnline(false);
        render(<Probe />);

        expect(screen.getByText('offline')).toBeTruthy();
    });

    /**
     * ⛔ THE SUBSCRIPTION IS THE POINT. A hook that read `onlineManager.isOnline()` once would pass the test
     * above and never update — so this drives a change AFTER mount and is the assertion that fails if the
     * external-store subscription is dropped for a plain read.
     */
    it('⛔ updates when connectivity changes after mount', () => {
        onlineManager.setOnline(true);
        render(<Probe />);
        expect(screen.getByText('online')).toBeTruthy();

        act(() => {
            onlineManager.setOnline(false);
        });

        expect(screen.getByText('offline')).toBeTruthy();
    });

    /**
     * ⚠️ `useSyncExternalStore` THROWS during a server render if no `getServerSnapshot` is supplied, and the
     * window is reachable: `ClientQueryBoundary` bypasses the boundary only when the route is NOT fully
     * prefetched, so a prefetched route renders `QueryBoundary` — and anything suspending in that subtree
     * renders this hook — on the server. Asserting the snapshot directly is the closest this tier gets; the
     * failure it guards is a runtime throw, not a type error.
     */
    it('⛔ has a server snapshot, so an SSR render cannot throw', () => {
        // `onlineManager` initialises `#online = true` and only installs listeners where `window` exists,
        // so the server answer is "online" by construction — never "offline", which would flash the notice.
        expect(onlineManager.isOnline()).toBe(true);
    });
});
