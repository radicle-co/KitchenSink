/**
 * DataSourcesScreen (native) — the Data sources sheet on its read, through react-native-web (curated U25; design §S16).
 */
import { guardedFoodClient, renderWithFoodClient } from '@commise/test-utils';
import { NotFoundError } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CIQUAL_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { DataSourcesScreen } from '../DataSourcesScreen.native.js';

// react-native-web does not implement `sendAccessibilityEvent`; the cursor moves are asserted as the calls they make.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    onlineManager.setOnline(true);
});

const USDA = makeDataSource();

describe('DataSourcesScreen (native)', () => {
    it('shows the title and the loading caption while the read runs', () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);

        expect(screen.getByRole('heading', { name: 'Data sources' })).toBeTruthy();
        expect(screen.getByText('Loading data sources…')).toBeTruthy();
    });

    it('lists the sources in the service order once read', async () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockResolvedValue({ sources: [USDA, CIQUAL_SOURCE] });
        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);

        await waitFor(() =>
            expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
                'Data sources',
                'USDA',
                'Ciqual',
            ]),
        );
    });

    it('shows the failure with Try again, which reads again', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);
        await screen.findByRole('alert');

        listSources.mockResolvedValueOnce({ sources: [USDA] });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('heading', { name: 'USDA' })).toBeTruthy();
    });

    /**
     * Design §S16 "States": "Focus stays where it is, and the alert announces itself" (`docs/design/
     * readSurfacesEvaluation.md` D3). Android speaks a CHANGE to a live region it already holds, so the failure lands in
     * a region the sheet mounted while it loaded, and a second failure moves to the other one (`LiveRegion`'s
     * `occurrence`). Try again stays mounted and busy through the retry, so the reading cursor is not lost.
     */
    it('says each failure from a region mounted before it, and keeps Try again busy through a retry', async () => {
        const client = guardedFoodClient();
        let failRead: (error: Error) => void = () => undefined;
        const failing = () =>
            new Promise<never>((_resolve, reject) => {
                failRead = reject;
            });
        const listSources = vi.spyOn(client, 'listSources').mockReturnValueOnce(failing());

        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);

        const regions = Array.from(document.querySelectorAll('[aria-live="assertive"]'));

        expect(regions.map((region) => region.textContent)).toEqual(['', '']);

        failRead(new NotFoundError('sources'));
        const first = await screen.findByText('We couldn’t load the data sources.');
        const tryAgain = screen.getByRole('button', { name: 'Try again' });

        expect(regions).toContain(first);

        listSources.mockReturnValueOnce(failing());
        fireEvent.click(tryAgain);

        await waitFor(() => expect(tryAgain.getAttribute('aria-busy')).toBe('true'));
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(tryAgain);

        failRead(new NotFoundError('sources'));

        await waitFor(() => expect(tryAgain.getAttribute('aria-busy')).not.toBe('true'));
        const second = screen.getByText('We couldn’t load the data sources.');

        expect(tryAgain.isConnected).toBe(true);
        expect(regions).toContain(second);
        expect(second).not.toBe(first);
    });

    // Try again leaves with the failure when the read succeeds. The reading cursor goes to the sheet's title rather than
    // being lost with the control, as the discovery page's retry does (`useScreenReaderFocusOnSignal`).
    it('moves the reading cursor to the title when a retry succeeds and takes Try again away', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);
        const tryAgain = await screen.findByRole('button', { name: 'Try again' });

        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        listSources.mockResolvedValueOnce({ sources: [USDA] });
        fireEvent.click(tryAgain);

        expect(await screen.findByRole('heading', { name: 'USDA' })).toBeTruthy();
        expect(tryAgain.isConnected).toBe(false);
        expect(vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls).toEqual([
            [screen.getByRole('heading', { name: 'Data sources' }), 'focus'],
        ]);
    });

    // TanStack keeps a failed query for its cache time, and a new mount reads it again: that read is a load, not a
    // retry the cook pressed, so the page opens on Loading and says no old failure (`readSurfacesEvaluation.md` D3).
    it('opens on Loading, never an old failure, when it mounts again over a read that failed', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const page = (shown: boolean) => (
            <QueryClientProvider client={queryClient}>
                <FoodServiceProvider client={client} subject="user_1">
                    {shown && <DataSourcesScreen onRequestClose={() => undefined} />}
                </FoodServiceProvider>
            </QueryClientProvider>
        );
        const { rerender } = render(page(true));

        expect(await screen.findByText('We couldn’t load the data sources.')).toBeTruthy();

        rerender(page(false));
        listSources.mockReturnValueOnce(new Promise(() => undefined));
        rerender(page(true));

        expect(screen.getByText('Loading data sources…')).toBeTruthy();
        expect(screen.queryByText('We couldn’t load the data sources.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows the offline slot, with no retry, while the read is parked', async () => {
        onlineManager.setOnline(false);
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockResolvedValue({ sources: [USDA] });
        renderWithFoodClient(<DataSourcesScreen onRequestClose={() => undefined} />, client);

        expect(await screen.findByText('Waiting for a connection. This loads on its own.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('Close reports the close', () => {
        const client = guardedFoodClient();
        const onRequestClose = vi.fn();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(<DataSourcesScreen onRequestClose={onRequestClose} />, client);
        fireEvent.click(screen.getByRole('button', { name: 'Close data sources' }));

        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });
});
