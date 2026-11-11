// @vitest-environment jsdom
/**
 * The web shell, composed for real (blueprint slice 3, "Integration (frontend)"): `AppShell` with the REAL design system
 * (`@commise/ui` — scroll host, chrome surface, avatar disc, create dial) and the REAL shared nav model
 * (`@commise/features-core`), only the auth-backed profile read and the router stubbed. The component suites each stub
 * a neighbour; this proves the pieces fit: two navigation landmarks (CSS shows one at a time), the three reachable
 * destinations in the sidebar and those three plus You in the tab bar, the profile row first in the sidebar and then New
 * recipe, no top bar, and the page's H1 the only one. Rewritten for the You tab (owner ruling 2026-11-11, N3): the
 * sidebar's first row is Profile and the tab bar has a fourth item, You, to the same place.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { AppShell } from '@/components/app/AppShell';

vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en/recipes',
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ isPending: false, isError: false, data: { user: { displayName: 'Eliza Mendes' } } }),
}));
// The shell's `/` shortcut reads the viewer's settings (D19); this suite composes the chrome, not the shortcut.
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ data: { searchShortcut: true } }) }));

describe('the web shell, composed', () => {
    it('renders the sidebar and the tab bar over the real nav model, Profile first, no top bar, one H1', () => {
        renderWithProviders(
            <AppShell activeId="recipes" titleId="recipes">
                <h1>Recipes</h1>
            </AppShell>,
        );

        // Two landmarks with two names (W-14): a screen-reader landmark list must tell them apart.
        const sidebarNav = screen.getByRole('navigation', { name: 'Main' });
        const tabBar = screen.getByRole('navigation', { name: 'Tabs' });

        expect(sidebarNav).toBeDefined();
        expect(tabBar?.hasAttribute('data-tab-bar')).toBe(true);

        for (const nav of [sidebarNav, tabBar]) {
            expect(within(nav as HTMLElement).getByRole('link', { name: 'Recipes' })).toHaveAttribute(
                'aria-current',
                'page',
            );
        }

        // The sidebar lists the three destinations; You is the profile row above them, not a fourth row.
        expect(
            within(sidebarNav as HTMLElement)
                .getAllByRole('link')
                .map((link) => link.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover']);
        // The tab bar adds You last: the cook's disc (initials) over the label, named by the label alone.
        expect(
            within(tabBar as HTMLElement)
                .getAllByRole('link')
                .map((link) => link.querySelector('.text-caption')?.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover', 'You']);
        expect(within(tabBar as HTMLElement).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/en/profile');

        const profileRow = screen.getByRole('link', { name: 'Profile, Eliza Mendes' });
        const newRecipe = screen.getByRole('button', { name: 'New recipe' });
        expect(profileRow).toHaveAttribute('href', '/en/profile');
        expect(profileRow.compareDocumentPosition(newRecipe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(
            newRecipe.compareDocumentPosition(sidebarNav as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(document.title).toBe('Recipes · Commise');
    });
});
