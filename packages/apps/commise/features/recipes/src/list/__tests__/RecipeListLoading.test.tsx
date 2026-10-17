// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list LOADING fallback — what the list's `Suspense` renders while the library is
 * pending. Moved from the retired `RecipeList.test.tsx` ("loading state", and the loading half of "create FAB (L1)").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeListLoading } from '../RecipeListLoading.js';

afterEach(cleanup);

describe('RecipeListLoading (web)', () => {
    it('shows a busy status and no recipe rows', () => {
        render(<RecipeListLoading variant="row" />);

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        render(<RecipeListLoading variant="row" />);

        // The shimmer placeholders are all `aria-hidden`, and a live region announces its CONTENT, not its label.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    it('renders real shimmer skeleton rows (not blank spans), hidden from assistive tech (U5)', () => {
        render(<RecipeListLoading variant="row" />);

        const shimmer = screen.getByRole('status').querySelectorAll('.animate-pulse');
        expect(shimmer.length).toBeGreaterThanOrEqual(3);

        for (const node of Array.from(shimmer)) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('⛔ offers NO create control at all while the library is unresolved', () => {
        // THE mid-press-unmount defect, now held structurally. While the library has not answered, "zero recipes" is
        // unknown rather than empty: the dial used to mount through this window, a first-run cook pressed it, the menu
        // opened, the empty library settled and the whole control detached under their finger (Playwright:
        // `element was detached from the DOM`). The settled empty results offer only their own CTA, so a cook is never
        // handed a create control that the transition takes away.
        render(<RecipeListLoading variant="row" />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    // Slice 4 (`buildSpec.md` §4.3 Loading: "6 skeletons of the active variant").
    it.each(['row', 'grid'] as const)('draws six skeletons of the active %s variant', (variant) => {
        const { container } = render(<RecipeListLoading variant={variant} />);
        const skeletons = container.querySelectorAll(`[data-skeleton-variant="${variant}"]`);

        expect(skeletons).toHaveLength(6);
    });
});
