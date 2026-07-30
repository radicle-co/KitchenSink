// @vitest-environment jsdom
/**
 * Tests for the app-wide navigation shell (W1/L9). Verifies the shared chrome wraps an arbitrary surface —
 * so routes beyond Home (the recipe list, …) get the SAME sidebar/bottom-nav — that the surface's own
 * destination is marked current, and that the top bar names the SURFACE rather than always saying "Home".
 * The viewer-profile hook is mocked; the locale comes from a provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { webMessages } from '@/i18n/messages';
import { SHELL_SURFACE_IDS, type ShellSurfaceId } from '@/components/app/shellSurfaces';

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

const { AppShell } = await import('../AppShell');

afterEach(cleanup);

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
 * The top-bar title was hard-coded to `chrome.pageTitle` ('Home'), so every one of the 15 shell-hosted routes
 * announced itself as "Home". It is now per-surface, defaulting to Home so nothing regresses for a caller that
 * says nothing.
 *
 * The title is passed as an ID, not a resolved string: the shell-hosted routes are SERVER components with no
 * locale context, while `AppShell` already owns it — and an id-keyed record makes a surface with no copy a
 * COMPILE error instead of a blank bar discovered in review.
 */
describe('AppShell — per-surface top-bar title', () => {
    it('defaults to the Home title when no titleId is given (today’s behaviour, unchanged)', () => {
        renderShell('home');

        expect(within(screen.getByRole('banner')).getByText(titles.home)).toBeTruthy();
    });

    it.each(SHELL_SURFACE_IDS)('renders the localized title for the "%s" surface', (titleId) => {
        renderShell('recipes', titleId);

        expect(within(screen.getByRole('banner')).getByText(titles[titleId])).toBeTruthy();
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
