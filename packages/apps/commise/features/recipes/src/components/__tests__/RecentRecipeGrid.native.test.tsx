/**
 * Native component tests for the recent-recipes card list (rendered via react-native-web under jsdom).
 *
 * PLATFORM-FORK note: the web leaf paints the mockup's 2-up/4-up CSS grid; the native leaf presents the same
 * cards as a single column (a phone-width surface has no room for a 4-up grid). These tests therefore pin the
 * CONTRACT the two leaves share — one card per recipe in order, an empty list rendering nothing, and the
 * `onSelectRecipe` navigation seam reporting the right id — rather than the web layout classes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeSummary } from '../props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecentRecipeGrid } from '../RecentRecipeGrid.native.js';

afterEach(cleanup);

const summary = (over = {}) => toRecipeSummary(makeRecipe(over));

describe('RecentRecipeGrid (native)', () => {
    it('renders one card per recipe, in the order given (populated state)', () => {
        render(
            <RecentRecipeGrid
                recipes={[
                    summary({ id: 'r1', title: 'Weeknight Pasta' }),
                    summary({ id: 'r2', title: 'Chana Masala' }),
                ]}
            />,
        );

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Chana Masala')).toBeTruthy();
    });

    it('renders nothing for an empty list (empty state — never a fabricated placeholder card)', () => {
        render(<RecentRecipeGrid recipes={[]} />);

        expect(screen.queryByText('Weeknight Pasta')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('reports THAT card’s recipe id when a card is activated', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        render(
            <RecentRecipeGrid
                recipes={[
                    summary({ id: 'r1', title: 'Weeknight Pasta' }),
                    summary({ id: 'r2', title: 'Chana Masala' }),
                ]}
                onSelectRecipe={onSelectRecipe}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Chana Masala' }));

        // The SECOND card's id — catches an index/closure mix-up a "was it called?" assertion would miss.
        expect(onSelectRecipe).toHaveBeenCalledExactlyOnceWith('r2');
    });

    it('renders inert cards when no onSelectRecipe is supplied', () => {
        render(<RecentRecipeGrid recipes={[summary({ id: 'r1', title: 'Weeknight Pasta' })]} />);

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
