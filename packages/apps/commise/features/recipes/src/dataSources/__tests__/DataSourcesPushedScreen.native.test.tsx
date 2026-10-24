/**
 * DataSourcesPushedScreen (native) — the Data sources PAGE on its read, pushed onto the Profile stack (A-026;
 * `buildSpec.md` §9.2: back to Profile, the H1 "Data sources"). The same read states as the sheet in `DataSourcesPushedScreen`
 * (which the recipe detail still opens), under a pushed page's frame: Back to Profile instead of Close.
 */
import { guardedFoodClient, renderWithFoodClient } from '@commise/test-utils';
import { NotFoundError } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CIQUAL_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { DataSourcesPushedScreen } from '../DataSourcesPushedScreen.native.js';
import { dataSourcesMessages } from '../messages.js';

// react-native-web does not implement `sendAccessibilityEvent`; the cursor moves are asserted as the calls they make.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme({
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    });
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    vi.restoreAllMocks();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    onlineManager.setOnline(true);
});

const USDA = makeDataSource();
const BACK = { label: 'Back to Profile', parent: 'Profile', onPress: () => undefined };

describe('DataSourcesPushedScreen (native)', () => {
    it('shows the title and the loading caption while the read runs', () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);

        expect(screen.getByRole('heading', { name: 'Data sources' })).toBeTruthy();
        expect(screen.getByText('Loading data sources…')).toBeTruthy();
    });

    it('lists the sources in the service order once read', async () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockResolvedValue({ sources: [USDA, CIQUAL_SOURCE] });
        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);

        await waitFor(() =>
            expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
                'Data sources',
                USDA.publisher,
                CIQUAL_SOURCE.publisher,
            ]),
        );
    });

    it('shows the failure with Try again, which reads again', async () => {
        const client = guardedFoodClient();
        const listSources = vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));

        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);
        await screen.findByRole('alert');

        listSources.mockResolvedValueOnce({ sources: [USDA] });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('heading', { name: USDA.publisher })).toBeTruthy();
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

        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);

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

        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);
        const tryAgain = await screen.findByRole('button', { name: 'Try again' });

        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        listSources.mockResolvedValueOnce({ sources: [USDA] });
        fireEvent.click(tryAgain);

        expect(await screen.findByRole('heading', { name: USDA.publisher })).toBeTruthy();
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
                    {shown && <DataSourcesPushedScreen back={BACK} />}
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
        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);

        expect(await screen.findByText('Waiting for a connection. This loads on its own.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('is a pushed page: Back to Profile reports the way back, and there is no Close', () => {
        const client = guardedFoodClient();
        const onPress = vi.fn();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(<DataSourcesPushedScreen back={{ ...BACK, onPress }} />, client);

        expect(screen.getByRole('heading', { name: 'Data sources', level: 1 })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Close data sources' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });
});

describe.each(['light', 'dark'] as const)('DataSourcesPushedScreen (native) — the %s scheme', (scheme) => {
    it('says a failed read in ink (D15)', async () => {
        systemScheme.current = scheme;
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockRejectedValueOnce(new NotFoundError('sources'));
        renderWithFoodClient(<DataSourcesPushedScreen back={BACK} />, client);
        await screen.findByRole('alert');
        const words = await screen.findAllByText(dataSourcesMessages.en.loadFailed);

        for (const element of words) {
            expect(getComputedStyle(element).color).toBe(rgb((scheme === 'dark' ? roleDark : role).ink));
        }
    });
});
