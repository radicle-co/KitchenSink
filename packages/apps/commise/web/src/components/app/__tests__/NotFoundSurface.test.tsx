// @vitest-environment jsdom
/**
 * The frame an unknown URL is shown in (E2, `docs/design/uiOverhaul/evaluateShellAndLists.md`; spec
 * `specShellAndLists.md` §N). Unknown URLs used to get Next's bare built-in 404: no app styles, no brand and no way
 * home, signed in or out. Now a signed-in viewer gets the page inside the app shell, so they are never stranded, and a
 * signed-out viewer gets it on the plain canvas the sign-in page uses. Either way it says "not found" in the page's
 * one `h1` and links home; it is a page, not an alert.
 */
import { renderWithProviders } from '@commise/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }));

vi.mock('@clerk/nextjs', () => ({ useAuth: () => authState }));
vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useParams: () => ({ locale: 'en' }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en/nope',
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

const { NotFoundSurface } = await import('../NotFoundSurface');

afterEach(cleanup);

function renderSurface(signedIn: boolean): void {
    authState.isSignedIn = signedIn;
    renderWithProviders(
        <QueryClientProvider client={new QueryClient()}>
            <NotFoundSurface />
        </QueryClientProvider>,
    );
}

describe('NotFoundSurface (E2)', () => {
    it('shows a signed-in viewer the page inside the app shell, titled as such', () => {
        renderSurface(true);

        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
        expect(document.title).toBe('Page not found · Commise');
        expect(screen.getByRole('heading', { level: 1, name: 'We couldn’t find that page.' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Back to Home' }).getAttribute('href')).toBe('/en');
    });

    it('shows a signed-out viewer the page with no app navigation', () => {
        renderSurface(false);

        expect(screen.queryAllByRole('navigation')).toEqual([]);
        expect(screen.getByRole('heading', { level: 1, name: 'We couldn’t find that page.' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Back to Home' }).getAttribute('href')).toBe('/en');
    });

    it('is a page, not an interruption: nothing on it is an alert', () => {
        renderSurface(true);

        expect(screen.queryAllByRole('alert')).toEqual([]);
    });
});
