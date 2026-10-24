// @vitest-environment jsdom
/**
 * The web version history's LOADING state (D3; `buildSpec.md` §6.6: "Loading: 3 skeleton rows"). It sits under the SAME
 * header the settled list draws — the back control and the title — so nothing moves when the history lands.
 *
 * Pinned back bar: the FRAME is the container's (`RecipeVersionsRouteLoading`, with `RecipeVersionsContainer`), so this leaf
 * draws the header's eyebrow only (shown from 840) and no bar; `RecipeRouteLoading.test.tsx` asserts the bar around it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeVersionListSkeleton } from '../RecipeVersionListSkeleton.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

/** The page's only Back: the header's eyebrow. */
const eyebrowBack = (): HTMLElement => {
    const all = screen.getAllByRole('link', { name: versionList.backToRecipe, hidden: true });

    expect(all).toHaveLength(1);

    return all[0] as HTMLElement;
};

afterEach(cleanup);

describe('RecipeVersionListSkeleton (web)', () => {
    it('keeps the settled list’s header: the title, and the way back as its eyebrow alone', () => {
        const { container } = render(
            <RecipeVersionListSkeleton label="Loading version history" onBack={vi.fn()} backHref="/en/recipes/r1" />,
        );

        expect(screen.getByRole('heading', { level: 1, name: versionList.heading })).toBeTruthy();
        expect(eyebrowBack().className).toContain('nav:inline-flex');
        // The bar and its frame are the container's: a frame here too would draw TWO bars.
        expect(container.querySelector('[data-condensed]')).toBeNull();
        expect(container.querySelector('[data-pushed-page]')).toBeNull();
    });

    it('names the eyebrow’s parent “Recipe”, not the control’s own label', () => {
        render(
            <RecipeVersionListSkeleton label="Loading version history" onBack={vi.fn()} backHref="/en/recipes/r1" />,
        );

        expect(eyebrowBack().textContent).toBe(versionList.recipeParent);
    });

    it('draws no bar and no frame when it is given no way back', () => {
        const { container } = render(<RecipeVersionListSkeleton label="Loading version history" />);

        expect(container.querySelector('[data-pushed-page]')).toBeNull();
        expect(screen.queryByRole('link', { hidden: true })).toBeNull();
    });

    it('is ONE polite status named for what is loading, over three decorative rows', () => {
        const { container } = render(<RecipeVersionListSkeleton label="Loading version history" onBack={vi.fn()} />);

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status', { name: 'Loading version history' }).textContent).toContain(
            'Loading version history',
        );
        const rows = container.querySelectorAll('[data-skeleton-row]');
        expect(rows).toHaveLength(3);

        for (const row of rows) {
            expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('goes back when the back control is used', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        render(<RecipeVersionListSkeleton label="Loading version history" onBack={onBack} backHref="/en/recipes/r1" />);

        await user.click(eyebrowBack());

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
