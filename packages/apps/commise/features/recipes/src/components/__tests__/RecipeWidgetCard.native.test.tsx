/**
 * Native component tests for the recipe-widget card shell (rendered via react-native-web under jsdom).
 * RNW maps the View's accessibilityRole="summary"+accessibilityLabel to a labelled <section role="region">
 * and the Text's accessibilityRole="header" to a <h* role="heading">, mirroring the web leaf's semantics.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeWidgetCard } from '../RecipeWidgetCard.native.js';

afterEach(cleanup);

describe('RecipeWidgetCard (native)', () => {
    it('renders the title as a heading', () => {
        render(<RecipeWidgetCard title="Recent recipes" />);

        expect(screen.getByRole('heading', { name: 'Recent recipes' })).toBeTruthy();
    });

    it('exposes the card as a region whose accessible name is the title', () => {
        render(<RecipeWidgetCard title="Recent recipes" />);

        expect(screen.getByRole('region', { name: 'Recent recipes' })).toBeTruthy();
    });

    it('renders its children inside the card body', () => {
        render(
            <RecipeWidgetCard title="Recent recipes">
                <span>body-content</span>
            </RecipeWidgetCard>,
        );

        const region = screen.getByRole('region', { name: 'Recent recipes' });
        expect(within(region).getByText('body-content')).toBeTruthy();
    });
});
