// @vitest-environment jsdom
/**
 * Component tests for the web {@link RecentRecipeGrid} — the Home "Recent recipes" card GRID (mockup
 * `screen-home`: `grid grid-cols-2 md:grid-cols-4 gap-4`, each cell a tappable card through to the recipe).
 *
 * Covers EVERY state of this render leaf: populated (one card per recipe, in order), empty (a list with no
 * items — never a fabricated placeholder card), selectable (a card reports ITS OWN id, not a neighbour's) and
 * non-selectable (no `onSelectRecipe` ⇒ inert cards, not dead buttons).
 *
 * The layout assertion is deliberate and narrow: the two/four-column responsive grid IS the mockup gap this
 * component closes, so it is pinned. Everything else asserts on roles, accessible names, and the id the
 * callback receives — a restyle does not fail these, but a stacked layout, a dropped card, an unwired card, or
 * a card reporting the wrong id does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeSummary } from '../props.js';
import { RecentRecipeGrid } from '../RecentRecipeGrid.js';

afterEach(cleanup);

const summary = (over = {}) => toRecipeSummary(makeRecipe(over));

const renderGrid = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecentRecipeGrid (web)', () => {
    it('lays the cards out as the mockup 2-up / 4-up responsive grid (NOT a vertical stack)', () => {
        const { container } = renderGrid(<RecentRecipeGrid recipes={[summary({ id: 'r1', title: 'Ragu' })]} />);
        const list = container.querySelector('ul');
        const className = list?.className ?? '';

        expect(className).toContain('grid');
        expect(className).toContain('grid-cols-2');
        expect(className).toContain('md:grid-cols-4');
        // A stacked single-column list is exactly the pre-parity shape this component replaces.
        expect(className).not.toContain('flex-col');
    });

    it('renders one card per recipe, in the order given (populated state)', () => {
        renderGrid(
            <RecentRecipeGrid
                recipes={[
                    summary({ id: 'r1', title: 'Weeknight Pasta' }),
                    summary({ id: 'r2', title: 'Chana Masala' }),
                    summary({ id: 'r3', title: 'Herb Risotto' }),
                ]}
            />,
        );

        const titles = screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'));
        expect(titles).toEqual(['Weeknight Pasta', 'Chana Masala', 'Herb Risotto']);
    });

    it('renders NO cards for an empty list (empty state — never a fabricated placeholder card)', () => {
        const { container } = renderGrid(<RecentRecipeGrid recipes={[]} />);

        expect(screen.queryByRole('article')).toBeNull();
        expect(container.querySelectorAll('li')).toHaveLength(0);
    });

    it('makes each card actionable and reports THAT card’s id when it is activated', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderGrid(
            <RecentRecipeGrid
                recipes={[
                    summary({ id: 'r1', title: 'Weeknight Pasta' }),
                    summary({ id: 'r2', title: 'Chana Masala' }),
                ]}
                onSelectRecipe={onSelectRecipe}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Chana Masala' }));

        // The SECOND card's id — pinning this catches an index/closure mix-up that a "was it called?" assertion
        // would sail straight past.
        expect(onSelectRecipe).toHaveBeenCalledExactlyOnceWith('r2');
    });

    it('renders inert cards (no buttons) when no onSelectRecipe is supplied', () => {
        renderGrid(<RecentRecipeGrid recipes={[summary({ id: 'r1', title: 'Weeknight Pasta' })]} />);

        expect(screen.getByRole('article', { name: 'Weeknight Pasta' })).toBeTruthy();
        // A dead button would look actionable to a keyboard/AT user and do nothing — the card must not be one.
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).toBeNull();
    });
});
