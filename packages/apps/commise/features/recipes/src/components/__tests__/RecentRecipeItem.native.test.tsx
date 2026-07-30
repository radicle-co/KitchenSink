/**
 * Native component tests for the recent-recipe card (rendered via react-native-web under jsdom). The STARS
 * stay display-only (the widget shows the viewer's own recipes, so no in-widget rating), while the CARD is
 * tappable through to the recipe when the host supplies `onSelect` — the same seam the web leaf honours, so
 * the two platforms cannot drift on the affordance. The full card-state matrix lives in the RecipeCard suite;
 * this pins BOTH of this leaf's branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeSummary } from '../props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecentRecipeItem } from '../RecentRecipeItem.native.js';

afterEach(cleanup);

const summary = (over = {}) => toRecipeSummary(makeRecipe(over));

describe('RecentRecipeItem (native)', () => {
    it('renders the recipe title as visible text', () => {
        render(<RecentRecipeItem recipe={summary({ title: 'Chana Masala' })} />);

        expect(screen.getByText('Chana Masala')).toBeTruthy();
    });

    it('renders the enriched card facets (time, servings)', () => {
        render(<RecentRecipeItem recipe={summary({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    it('is inert when the host supplies no onSelect (no dead control, no in-widget rating)', () => {
        render(<RecentRecipeItem recipe={summary({ title: 'Chana Masala' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('is an actionable card reporting ITS recipe id when the host supplies onSelect', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<RecentRecipeItem recipe={summary({ id: 'rec_7', title: 'Chana Masala' })} onSelect={onSelect} />);

        await user.click(screen.getByRole('button', { name: 'Chana Masala' }));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('rec_7');
    });
});
