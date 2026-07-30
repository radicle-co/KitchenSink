// @vitest-environment jsdom
/**
 * Component tests for the web recent-recipe card — the Home-widget leaf. It renders the shared mockup-parity
 * card (title, meta, rating) named by the title; the STARS stay display-only (the widget shows the viewer's own
 * recipes, so there is no in-widget rating action), while the CARD is tappable through to the recipe detail
 * when the host supplies `onSelect` (mockup `screen-home`). The full card-state matrix is covered by the
 * RecipeCard suite; this pins BOTH of this leaf's branches — actionable and inert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

    it('is inert when the host supplies no onSelect (no dead button, no in-widget rating control)', () => {
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

    it('still exposes the stars as DISPLAY-ONLY when the card is actionable (no rating control appears)', () => {
        render(
            <RecentRecipeItem
                recipe={summary({ title: 'Chana Masala', averageRating: 4.5, ratingCount: 12 })}
                onSelect={() => undefined}
            />,
        );

        // Exactly one control — the card itself. A rating input would add radio/button controls per star.
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('img', { name: /^Rated 4\.5 out of 5/ })).toBeTruthy();
    });
});
