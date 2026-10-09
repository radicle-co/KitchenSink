// @vitest-environment jsdom
/**
 * The web shell, composed for real (blueprint slice 3, "Integration (frontend)"): `AppShell` with the REAL design system
 * (`@commise/ui` — scroll host, chrome surface, avatar disc, create dial) and the REAL shared nav model
 * (`@commise/features-core`), only the auth-backed profile read and the router stubbed. The component suites each stub
 * a neighbour; this proves the pieces fit: two navigation landmarks (CSS shows one at a time), the three reachable
 * destinations in each, New recipe first in the sidebar, no top bar, and the page's H1 the only one.
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

describe('the web shell, composed', () => {
    it('renders the sidebar and the tab bar over the real nav model, New recipe first, no top bar, one H1', () => {
        renderWithProviders(
            <AppShell activeId="recipes" titleId="recipes">
                <h1>Recipes</h1>
            </AppShell>,
        );

        const [sidebarNav, tabBar] = screen.getAllByRole('navigation', { name: 'Main' });

        expect(sidebarNav).toBeDefined();
        expect(tabBar?.hasAttribute('data-tab-bar')).toBe(true);

        for (const nav of [sidebarNav, tabBar]) {
            expect(
                within(nav as HTMLElement)
                    .getAllByRole('link')
                    .map((link) => link.textContent),
            ).toEqual(['Home', 'Recipes', 'Discover']);
            expect(within(nav as HTMLElement).getByRole('link', { name: 'Recipes' })).toHaveAttribute(
                'aria-current',
                'page',
            );
        }

        const newRecipe = screen.getByRole('button', { name: 'New recipe' });
        expect(
            newRecipe.compareDocumentPosition(sidebarNav as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Profile, Eliza Mendes' })).toHaveAttribute('href', '/en/profile');
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(document.title).toBe('Recipes · Commise');
    });
});
