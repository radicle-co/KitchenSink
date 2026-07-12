// @vitest-environment jsdom
/**
 * Component tests for the web recipe-widget card shell — every rendered facet of the leaf: the title as a
 * heading, the accessible labelled region named by that title, and the body slot (children) rendered inside.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { RecipeWidgetCard } from '../RecipeWidgetCard.js';

afterEach(cleanup);

describe('RecipeWidgetCard (web)', () => {
    it('renders the title as a heading', () => {
        render(<RecipeWidgetCard title="Recent recipes" />);

        expect(screen.getByRole('heading', { name: 'Recent recipes' })).toBeTruthy();
    });

    it('exposes the card as a region whose accessible name is the title', () => {
        render(<RecipeWidgetCard title="Recent recipes" />);

        // A <section> with an accessible name has the implicit ARIA role "region".
        expect(screen.getByRole('region', { name: 'Recent recipes' })).toBeTruthy();
    });

    it('renders its children inside the card body', () => {
        render(
            <RecipeWidgetCard title="Recent recipes">
                <span>body-content</span>
            </RecipeWidgetCard>,
        );

        const region = screen.getByRole('region', { name: 'Recent recipes' });
        // `within` proves the child is rendered *inside* the card, not merely somewhere on the page.
        expect(within(region).getByText('body-content')).toBeTruthy();
    });
});
