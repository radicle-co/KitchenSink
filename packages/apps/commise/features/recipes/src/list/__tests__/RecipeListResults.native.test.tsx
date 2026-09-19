/**
 * Native component tests for the recipe-list RESULTS (react-native-web under jsdom). Mirrors
 * `RecipeListResults.test.tsx` — see its header for what moved here from the retired `RecipeList.native.test.tsx` and
 * the two things (the Community branch, the search-driven narrowing cases) that deliberately did not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeListResults } from '../RecipeListResults.native.js';
import type { RecipeListResultsProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', totalTimeMinutes: 45 }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce', totalTimeMinutes: 20 }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad', totalTimeMinutes: 15 }),
];

function results(overrides: Partial<RecipeListResultsProps> = {}) {
    return (
        <RecipeListResults
            recipes={threeRecipes}
            narrowed={false}
            onSelectRecipe={noop}
            onCreateRecipe={noop}
            {...overrides}
        />
    );
}

describe('RecipeListResults (native) — populated', () => {
    it('renders a pluralized count and one button per recipe, reporting selection upward', () => {
        const onSelectRecipe = vi.fn();
        render(results({ onSelectRecipe }));

        expect(screen.getByText('3 recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('mounts the create dial over populated results, wired to both destinations', () => {
        const onPasteIngredients = vi.fn();
        render(results({ onPasteIngredients }));

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('still renders the rows when a pull-to-refresh control is wired (RefreshControl is inert in jsdom)', () => {
        render(results({ refresh: { refreshing: true, onRefresh: noop } }));

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByText('3 recipes')).toBeTruthy();
    });
});

describe('RecipeListResults (native) — a TRUE empty library', () => {
    it('shows the empty message and ONE create affordance — the empty CTA, never the dial', () => {
        render(results({ recipes: [] }));

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('wires the empty-state CTA to the create handler', () => {
        const onCreateRecipe = vi.fn();
        render(results({ recipes: [], onCreateRecipe }));

        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListResults (native) — a NARROWED zero (no-match)', () => {
    it('shows the no-match copy, offers no first-run CTA, and KEEPS the dial', () => {
        render(results({ recipes: [], narrowed: true }));

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });
});

describe('RecipeListResults (native) — quick-filter chips (L4)', () => {
    const chips = (overrides: Partial<NonNullable<RecipeListResultsProps['filters']>> = {}) =>
        results({
            filters: { available: ['Vegetarian', 'Italian'], active: [], onToggle: noop, onClear: noop, ...overrides },
        });

    it('renders no chip row when no filters prop is given', () => {
        render(results());

        expect(screen.queryByLabelText('Quick filters')).toBeNull();
    });

    it('renders a chip per available facet and reports a toggle upward', () => {
        const onToggle = vi.fn();
        render(chips({ onToggle }));

        expect(screen.getByLabelText('Quick filters')).toBeTruthy();
        fireEvent.click(screen.getByText('Vegetarian'));

        expect(onToggle).toHaveBeenCalledWith('Vegetarian');
    });

    it('renders a leading "All" chip that clears the filters', () => {
        const onClear = vi.fn();
        render(chips({ active: ['Vegetarian'], onClear }));

        fireEvent.click(screen.getByText('All'));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('renders the QUICK_TIME_FACET sentinel as the localized "Quick (<30m)" label, not the raw token', () => {
        const onToggle = vi.fn();
        render(chips({ available: ['quick', 'Italian'], onToggle }));

        expect(screen.queryByText('quick')).toBeNull();
        fireEvent.click(screen.getByText('Quick (<30m)'));

        expect(onToggle).toHaveBeenCalledWith('quick');
    });
});

/**
 * The chips' SELECTED state has to reach assistive tech on the mobile-WEB build too (#114). react-native-web forwards
 * literal `aria-*` props but projects `accessibilityState` for nothing, so `aria-pressed` is the web channel — and
 * `aria-pressed`, not `aria-selected`, because these are `role="button"` toggles. `accessibilityState` stays beside it
 * as the DEVICE trait, since RN does not map `aria-pressed` into it.
 */
describe('RecipeListResults (native) — the quick-filter chips announce their selected state on web too', () => {
    const withChips = (active: readonly string[]) =>
        render(
            results({
                filters: { available: ['Vegetarian', 'Italian'], active: [...active], onToggle: noop, onClear: noop },
            }),
        );

    it('marks an ACTIVE chip pressed and an INACTIVE one unpressed (present-and-false, not absent)', () => {
        withChips(['Italian']);

        expect(screen.getByRole('button', { name: 'Italian' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('marks the leading "All" chip pressed exactly when NO facet is active', () => {
        withChips([]);

        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');

        cleanup();
        withChips(['Italian']);

        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('reports exactly the active facet as pressed', () => {
        withChips(['Italian']);

        const pressed = screen
            .getAllByRole('button')
            .filter((button) => button.getAttribute('aria-pressed') === 'true')
            .map((button) => button.textContent);

        expect(pressed).toEqual(['Italian']);
    });
});

describe('RecipeListResults (native) — a failed refresh of the rows on screen', () => {
    const notice = (overrides: Partial<NonNullable<RecipeListResultsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    it('shows no notice while nothing has failed', () => {
        render(results({ refreshNotice: notice() }));

        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('⛔ keeps the rows and says the refresh failed, with a single-tap Try again beside the pull gesture', () => {
        const onRetry = vi.fn();
        render(results({ refreshNotice: notice({ failed: true, onRetry }) }));

        expect(screen.getByText('Mediterranean Grilled Lamb')).toBeTruthy();
        expect(screen.getAllByText('We couldn’t refresh your recipes.').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListResults (native) — the deferred calorie figure', () => {
    it('asks the host for each visible card’s figure by recipe id, and renders what it returns', () => {
        const renderNutrition = vi.fn((recipeId: string) => <Text>{`kcal for ${recipeId}`}</Text>);
        render(results({ renderNutrition }));

        expect(renderNutrition.mock.calls.map(([recipeId]) => recipeId)).toEqual(
            expect.arrayContaining(['rec_1', 'rec_2', 'rec_3']),
        );
        expect(screen.getByText('kcal for rec_2')).toBeTruthy();
    });
});
