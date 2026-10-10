// @vitest-environment jsdom
/**
 * Component test for the shared, PURE {@link RouteNotFoundState} (B18) — the localized fallback every web
 * App Router `not-found.tsx` boundary renders, with a way back to the current locale's home.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

// No route params, as on the global 404 page (`global-not-found.tsx`), which Next renders outside every route — so the
// way home must come from the locale the document was rendered with, never from `useParams`.
vi.mock('next/navigation', () => ({ useParams: () => ({}) }));

const { RouteNotFoundState } = await import('../RouteNotFoundState');

afterEach(() => {
    cleanup();
});

describe('RouteNotFoundState', () => {
    // Rewritten for E2 (`specShellAndLists.md` §N): this asserted `role="alert"`. A 404 is a page, not an interruption,
    // so its title is the page's `h1` and nothing is announced as an alert.
    it('renders localized not-found copy with a way back to the current locale home', () => {
        renderWithProviders(<RouteNotFoundState />);

        expect(screen.getByRole('heading', { level: 1, name: 'We couldn’t find that page.' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        const backLink = screen.getByRole('link');
        expect(backLink).toHaveAttribute('href', '/en');
    });

    // F18 (`evaluateFinal.md`): the 404 was plain text with an unstyled link. It is a terminal moment, so its block is
    // centred (`buildSpec.md` §1.3), its title is the page's large title, and the way home is the primary button.
    it('draws the branded 404: a centred block, the large title, and Back to Home as the primary button', () => {
        renderWithProviders(<RouteNotFoundState />);

        const heading = screen.getByRole('heading', { level: 1 });
        const block = heading.parentElement as HTMLElement;

        expect(heading.className.split(' ')).toEqual(expect.arrayContaining(['font-display', 'text-large-title']));
        expect(block.className.split(' ')).toEqual(expect.arrayContaining(['items-center', 'text-center']));
        expect(screen.getByRole('link', { name: 'Back to Home' }).className).toContain('bg-action');
    });
});
