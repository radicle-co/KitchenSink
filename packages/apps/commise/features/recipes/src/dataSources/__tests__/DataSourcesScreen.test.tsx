/**
 * DataSourcesScreen (web) — the Data sources page on its read (curated U25; design §S16 "States").
 */
import { guardedFoodClient, renderWithFoodClient } from '@commise/test-utils';
import { NotFoundError } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CIQUAL_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { DataSourcesScreen } from '../DataSourcesScreen.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
});

const USDA = makeDataSource();

describe('DataSourcesScreen (web)', () => {
    it('shows the heading at once and the loading caption while the read runs', () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(<DataSourcesScreen />, client);

        expect(screen.getByRole('heading', { level: 1, name: 'Data sources' })).toBeTruthy();
        expect(screen.getByText('Loading data sources…')).toBeTruthy();
    });

    it('lists the sources in the service order once read', async () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockResolvedValue({ sources: [USDA, CIQUAL_SOURCE] });
        renderWithFoodClient(<DataSourcesScreen />, client);

        const headings = await screen.findAllByRole('heading', { level: 2 });

        expect(headings.map((heading) => heading.textContent)).toEqual([USDA.publisher, CIQUAL_SOURCE.publisher]);
    });

    it('shows the failure with Try again, which reads again', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesScreen />, client);
        await screen.findByRole('alert');

        listSources.mockResolvedValueOnce({ sources: [USDA] });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1));
    });

    /**
     * WCAG 2.2 SC 2.4.3 and 4.1.3, design §S16 "States": "Focus stays where it is, and the alert announces itself"
     * (`docs/design/readSurfacesEvaluation.md` D3). Try again does not unmount while the read runs again, and a second
     * failure is a new alert node, because a live region is silent when its words do not change.
     */
    it('keeps Try again, focused and busy, through a retry, and announces a second failure with a new alert', async () => {
        const client = guardedFoodClient();
        let failRetry: (error: Error) => void = () => undefined;
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesScreen />, client);
        const firstAlert = await screen.findByRole('alert');
        const tryAgain = screen.getByRole('button', { name: 'Try again' });

        listSources.mockReturnValueOnce(
            new Promise((_resolve, reject) => {
                failRetry = reject;
            }),
        );
        tryAgain.focus();
        fireEvent.click(tryAgain);

        await waitFor(() => expect(tryAgain.getAttribute('aria-busy')).toBe('true'));
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(tryAgain);
        expect(document.activeElement).toBe(tryAgain);
        expect(screen.getByRole('alert')).toBe(firstAlert);

        failRetry(new NotFoundError('sources'));

        await waitFor(() => expect(tryAgain.getAttribute('aria-busy')).not.toBe('true'));
        expect(tryAgain.isConnected).toBe(true);
        expect(document.activeElement).toBe(tryAgain);
        expect(screen.getByRole('alert')).not.toBe(firstAlert);
        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load the data sources.');
    });

    // Try again leaves with the failure when the read succeeds. Focus goes to the page's heading rather than dropping to
    // the page (SC 2.4.3), as the discovery page's retry does (`useFocusOnSignal`).
    it('puts focus on the heading when a retry succeeds and takes Try again away', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesScreen />, client);
        await screen.findByRole('alert');
        const tryAgain = screen.getByRole('button', { name: 'Try again' });

        listSources.mockResolvedValueOnce({ sources: [USDA] });
        tryAgain.focus();
        fireEvent.click(tryAgain);

        expect(await screen.findByRole('heading', { level: 2, name: USDA.publisher })).toBeTruthy();
        expect(tryAgain.isConnected).toBe(false);
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Data sources' }));
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
                    {shown && <DataSourcesScreen />}
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
        renderWithFoodClient(<DataSourcesScreen />, client);

        expect(await screen.findByText('Waiting for a connection. This loads on its own.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows the empty copy for no sources', async () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockResolvedValue({ sources: [] });
        renderWithFoodClient(<DataSourcesScreen />, client);

        expect(await screen.findByText('No data sources to show yet.')).toBeTruthy();
    });
});
