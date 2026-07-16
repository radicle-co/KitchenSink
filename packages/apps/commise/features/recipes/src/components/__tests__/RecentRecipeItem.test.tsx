// @vitest-environment jsdom
/**
 * Component tests for the web recent-recipe card — the Home-widget leaf. It renders the shared mockup-parity
 * card (title, meta, rating) as a NON-interactive article named by the title (the widget shows the viewer's
 * own recipes, so there is no in-widget rating/selection here). The full card-state matrix is covered by the
 * RecipeCard suite; this asserts the widget wires the card in its non-interactive form.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeSummary } from '../props.js';
import { RecentRecipeItem } from '../RecentRecipeItem.js';

afterEach(cleanup);

const summary = (over = {}) => toRecipeSummary(makeRecipe(over));

describe('RecentRecipeItem (web)', () => {
    it('renders the recipe title and names the card by it', () => {
        render(<RecentRecipeItem recipe={summary({ title: 'Chana Masala' })} />);

        expect(screen.getByText('Chana Masala')).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Chana Masala' })).toBeTruthy();
    });

    it('renders the enriched card facets (time, servings)', () => {
        render(<RecentRecipeItem recipe={summary({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    it('is non-interactive in the widget (display-only — no rating/selection button)', () => {
        render(<RecentRecipeItem recipe={summary({ title: 'Chana Masala' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
