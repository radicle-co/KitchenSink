// @vitest-environment jsdom
/**
 * The `/legal/sources` route content (curated U25, design §S16): the Data sources page inside the shared shell,
 * reading food-service directly. The page's own states are covered by `DataSourcesScreen.test.tsx`; this suite
 * proves the route composes it, names itself, and owns the page's only `h1`.
 */
import { renderWithProviders } from '@commise/test-utils';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

const { SourcesContent } = await import('../SourcesContent');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** A food client whose sources read never settles, so the page stays in its loading state. */
function pendingClient(): FoodServiceClient {
    const client = new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });

    vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));

    return client;
}

describe('SourcesContent (U25)', () => {
    it('renders the Data sources page in the shell, with the only h1 and its own title', () => {
        renderWithProviders(
            <QueryClientProvider client={new QueryClient()}>
                <FoodServiceProvider client={pendingClient()} subject="user_1">
                    <SourcesContent />
                </FoodServiceProvider>
            </QueryClientProvider>,
        );

        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
        expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual([
            'Data sources',
        ]);
        expect(screen.getByText('Loading data sources…')).toBeTruthy();
    });
});
