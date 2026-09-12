/**
 * Native component tests for the recipe-widget card shell (rendered via react-native-web under jsdom).
 * RNW maps the View's accessibilityRole="summary" to a <section role="region"> and the Text's
 * accessibilityRole="header" to a <h* role="heading">. The card carries no name of its own: its header names it, so the
 * title is said once (`docs/design/nativeContainerNames.md` N1).
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

    it('renders its children inside the card body', () => {
        render(
            <RecipeWidgetCard title="Recent recipes">
                <span>body-content</span>
            </RecipeWidgetCard>,
        );

        const region = screen.getByRole('region');
        expect(within(region).getByText('body-content')).toBeTruthy();
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1: the card keeps its summary role (rule 4: it says the card summarises), and
 * its title header names it (rule 2), so the card carries no name and the title is said once (N4).
 */
describe('RecipeWidgetCard (native) — N1: a summary region whose title is said once', () => {
    it('keeps the summary region, says the title through one header, and labels no node with it', () => {
        render(<RecipeWidgetCard title="Recent recipes" />);

        expect(screen.getAllByRole('region')).toHaveLength(1);
        expect(screen.getAllByRole('heading', { name: 'Recent recipes' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Recent recipes')).toEqual([]);
    });
});
