/**
 * `PendingSlot` — who owns `fetchStatus: 'paused'`.
 *
 * ⛔ THE DEFECT THIS EXISTS FOR: a read with no cached data, while offline, does not fail — it parks at
 * `paused` with `isPending: true`, so the surface renders its loading state forever. §11.0 rules that offline
 * -with-nothing-cached is PENDING, not failed, so the pending slot owns it rather than the error boundary.
 *
 * Driven with a REAL `QueryClient` and the real `onlineManager`, because the decision reads both.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OfflineReadNoticeProvider } from '../offlineReadNotice.js';
import { PendingSlot } from '../pendingSlot.js';

/** Mounts the slot with a client holding one query parked at the given fetch status. */
function renderSlot(options: { readonly paused: boolean; readonly withProvider: boolean }): void {
    const client = new QueryClient();

    if (options.paused) {
        // A query the cache reports as paused — the state a suspended offline read is actually in.
        client
            .getQueryCache()
            .build(client, { queryKey: ['parked'] })
            .setState({ fetchStatus: 'paused' });
    }

    const slot = <PendingSlot>{<span>skeleton</span>}</PendingSlot>;

    render(
        <QueryClientProvider client={client}>
            {options.withProvider ? (
                <OfflineReadNoticeProvider renderOffline={() => <span>offline copy</span>}>
                    {slot}
                </OfflineReadNoticeProvider>
            ) : (
                slot
            )}
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

describe('PendingSlot', () => {
    it('renders the skeleton while merely loading', () => {
        renderSlot({ paused: false, withProvider: true });

        expect(screen.getByText('skeleton')).toBeTruthy();
        expect(screen.queryByText('offline copy')).toBeNull();
    });

    it('renders the offline copy when a read is parked AND we are offline', () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        renderSlot({ paused: true, withProvider: true });

        expect(screen.getByText('offline copy')).toBeTruthy();
        expect(screen.queryByText('skeleton')).toBeNull();
    });

    /**
     * ⛔ `paused` ALONE MUST NEVER MEAN OFFLINE, and this is the assertion that proves the conjunction is
     * real rather than decorative. `canContinue` also requires `focusManager.isFocused()`, and mobile drives
     * that from `AppState` — so a BACKGROUNDED app parks its queries while perfectly online, and self-heals
     * on foreground. Telling that viewer they are offline would be a lie with no recovery affordance.
     */
    it('⛔ renders the skeleton when parked but ONLINE (a backgrounded app, not an outage)', () => {
        renderSlot({ paused: true, withProvider: true });

        expect(screen.getByText('skeleton')).toBeTruthy();
        expect(screen.queryByText('offline copy')).toBeNull();
    });

    /**
     * ⛔ NO QUERY CLIENT AT ALL MUST NOT CRASH. This slot decorates the boundary's FALLBACK, and
     * `QueryBoundary` never needed a query client to render one — a leaf test or a storybook render can
     * legitimately mount it bare. Reaching for `useQueryClient()` here turned those from "works" into
     * "throws inside the loading state", which the mobile profile suite caught. Absent client ⇒ nothing can
     * be parked ⇒ render the children.
     */
    it('⛔ renders the skeleton with NO QueryClientProvider mounted', () => {
        act(() => {
            onlineManager.setOnline(false);
        });

        render(
            <OfflineReadNoticeProvider renderOffline={() => <span>offline copy</span>}>
                <PendingSlot>
                    <span>skeleton</span>
                </PendingSlot>
            </OfflineReadNoticeProvider>,
        );

        expect(screen.getByText('skeleton')).toBeTruthy();
    });

    /**
     * ⛔ THE NULL OBJECT IS THE "CONSUMERS DO NOT CHANGE" GUARANTEE. A tree with no provider must behave
     * exactly as it did before this module existed — so if the provider is ever mounted in the wrong place,
     * the failure is the OLD behaviour returning, never a crash and never a blank slot.
     */
    it('⛔ falls back to the skeleton with no provider mounted, even offline', () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        renderSlot({ paused: true, withProvider: false });

        expect(screen.getByText('skeleton')).toBeTruthy();
    });
});
