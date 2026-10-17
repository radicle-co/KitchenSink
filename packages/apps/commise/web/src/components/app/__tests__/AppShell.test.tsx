// @vitest-environment jsdom
/**
 * Tests for the app-wide navigation shell (W1/L9). Verifies the shared chrome wraps an arbitrary surface —
 * so routes beyond Home (the recipe list, …) get the SAME sidebar/bottom-nav — that the surface's own
 * destination is marked current, and that the top bar names the SURFACE rather than always saying "Home".
 * The viewer-profile hook is mocked; the locale comes from a provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { useSnackbar } from '@commise/ui/snackbar';
import type { JSX } from 'react';

import { renderWithProviders } from '@commise/test-utils';

import { webMessages } from '@/i18n/messages';
import { SHELL_SURFACE_IDS, type ShellSurfaceId } from '@/components/app/shellSurfaces';

// The shell's sidebar opens the editor through the router and its tab bar reads the route (slice 3).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en',
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));
// `useSearchShortcut` reads the viewer's settings (D19); this suite is about the chrome, not the shortcut.
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ data: { searchShortcut: true } }) }));

const { AppShell } = await import('../AppShell');

afterEach(() => {
    cleanup();
    pushMock.mockReset();
});

const titles = webMessages.en.home.chrome.pageTitles;

const renderShell = (activeId: 'home' | 'recipes', titleId?: ShellSurfaceId) =>
    renderWithProviders(
        <AppShell activeId={activeId} {...(titleId === undefined ? {} : { titleId })}>
            <p>surface content</p>
        </AppShell>,
    );

describe('AppShell', () => {
    it('renders the surface content inside the shared navigation chrome', () => {
        renderShell('recipes');

        expect(screen.getByText('surface content')).toBeTruthy();
        // The shell contributes the navigation landmarks (desktop sidebar + bottom tab bar).
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    it('marks the active destination as the current page', () => {
        const { container } = renderShell('recipes');

        expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
    });
});

/**
 * Slice 3 deleted the top bar (`buildSpec.md` §3.2): there is no banner and the page's large title is its only H1. The
 * page's NAME now goes to the document title, "{page} · Commise" (§3.3). The title is passed as an ID: the shell-hosted
 * routes are SERVER components with no locale context, and an id-keyed record makes a page with no copy a COMPILE error.
 */
describe('AppShell — the page name', () => {
    it('draws no top bar', () => {
        renderShell('home');

        expect(screen.queryByRole('banner')).toBeNull();
    });

    it('defaults the document title to Home', () => {
        renderShell('home');

        expect(document.title).toBe(`${titles.home} · Commise`);
    });

    it.each(SHELL_SURFACE_IDS)('names the "%s" page in the document title', (titleId) => {
        renderShell('recipes', titleId);

        expect(document.title).toBe(`${titles[titleId]} · Commise`);
    });

    it('wraps the page in its scroll host and puts the sidebar’s New recipe first', () => {
        renderShell('recipes');

        const [sidebarNav] = screen.getAllByRole('navigation');
        const newRecipe = screen.getByRole('button', { name: 'New recipe' });

        expect(
            sidebarNav === undefined
                ? 0
                : newRecipe.compareDocumentPosition(sidebarNav) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    /**
     * Pressing New recipe on the new-recipe page itself is a search-param-only navigation, which Next answers by keeping
     * the page's state — the old draft. A token that is new for every press is what tells the editor to start over.
     */
    it('⛔ opens the new recipe route with a token that is new for every press', async () => {
        renderShell('recipes');
        const press = screen.getByRole('button', { name: 'New recipe' });

        await userEvent.click(press);
        await userEvent.click(press);

        const hrefs = pushMock.mock.calls.map(([href]) => String(href));
        expect(hrefs).toHaveLength(2);
        expect(hrefs[0]).toMatch(/^\/en\/recipes\/new\?fresh=[\w-]+$/u);
        expect(hrefs[1]).toMatch(/^\/en\/recipes\/new\?fresh=[\w-]+$/u);
        expect(hrefs[0]).not.toBe(hrefs[1]);
    });

    /**
     * The defect this pairs with: the chrome title used to be an `<h1>`, and every shell route's own content
     * also renders one — two `h1`s per page. Exactly one must survive, and it must be the PAGE's.
     */
    it('leaves the page content as the document’s ONLY h1', () => {
        renderWithProviders(
            <AppShell activeId="recipes" titleId="recipes">
                <h1>Recipes</h1>
            </AppShell>,
        );

        const level1 = screen.getAllByRole('heading', { level: 1 });
        expect(level1).toHaveLength(1);
        expect(level1[0]?.textContent).toBe('Recipes');
    });

    /**
     * With the title per-route, a chrome heading would collide by NAME with the page's own `h1` on most routes
     * (both "Recipes"), making every `getByRole('heading', { name })` ambiguous. Plain text in the banner keeps
     * the surface name visible and announced by landmark, with no duplicate heading.
     */
    it('does not duplicate the page heading’s accessible name as a second heading', () => {
        renderWithProviders(
            <AppShell activeId="recipes" titleId="recipes">
                <h1>{titles.recipes}</h1>
            </AppShell>,
        );

        expect(screen.getAllByRole('heading', { name: titles.recipes })).toHaveLength(1);
    });
});

/**
 * UI-overhaul slice 2: the shell hosts the app's ONE snackbar (`@commise/ui/snackbar`), inside the shell's popup insets so
 * it can sit above the bottom tab bar.
 */
describe('AppShell — the snackbar host', () => {
    function Remover(): JSX.Element {
        const { show } = useSnackbar();

        return (
            <button type="button" onClick={() => show({ message: 'Removed Pasta' })}>
                Remove
            </button>
        );
    }

    it('lets a surface show a snackbar, which says itself in the status region', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <AppShell activeId="recipes">
                <Remover />
            </AppShell>,
        );

        await user.click(screen.getByRole('button', { name: 'Remove' }));

        // The shell now holds two status regions (P5): the snackbar's, and the sync notice's, empty while online.
        expect(screen.getAllByRole('status').map((region) => region.textContent)).toContain('Removed Pasta');
    });
});

/**
 * P5 (build spec §3.8): the connectivity notice lives at the top of `<main>`. It used to be mounted by the providers
 * above the whole document, so going offline pushed the sidebar and the page down together.
 */
describe('AppShell — the sync notice', () => {
    afterEach(() => {
        act(() => {
            onlineManager.setOnline(true);
        });
    });

    it('⛔ shows the offline notice inside <main>, not above the shell', () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        renderShell('recipes');

        const notice = screen.getByRole('status', { name: 'Sync status' });

        expect(within(screen.getByRole('main')).getByText('You’re offline')).toBeTruthy();
        expect(screen.getByRole('main').contains(notice)).toBe(true);
    });
});
