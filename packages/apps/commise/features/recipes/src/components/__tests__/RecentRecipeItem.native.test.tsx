/**
 * Native component tests for the recent-recipe card (rendered via react-native-web under jsdom). It renders
 * the shared mockup-parity card in its NON-interactive form (the widget shows the viewer's own recipes, so
 * no in-widget rating/selection). The full card-state matrix lives in the RecipeCard suite; this asserts the
 * widget wires the card non-interactively.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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

    it('is non-interactive in the widget (display-only — no rating/selection button)', () => {
        render(<RecentRecipeItem recipe={summary({ title: 'Chana Masala' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
