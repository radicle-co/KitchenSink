// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list RESULTS — what renders inside the list's suspense boundary once the library
 * has settled: the quick-filter chips, the refresh notice, the empty / no-match / populated body, and the create dial.
 *
 * Moved from the retired `RecipeList.test.tsx` ("quick-filter chips (L4)", "empty state", "no-match state",
 * "populated state", "touch targets", "a failed refresh of the rows on screen", and the settled half of "create FAB
 * (L1)"). Two things did NOT move, deliberately:
 *
 *  - the Community-tab empty copy and its dial suppression — no host renders this list on the Community source (the
 *    community surface is discovery), so the branch was deleted rather than ported;
 *  - "empty copy for a whitespace-only search" / "chips offered but none active" as SEARCH-driven cases — the leaf now
 *    receives the host's `narrowed` answer, and `isListNarrowed` is proven in `model.test.ts` and wired in the
 *    container tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeListResults } from '../RecipeListResults.js';
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

describe('RecipeListResults (web) — populated', () => {
    it('renders a pluralized result count', () => {
        render(results());

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('renders one card per recipe, in a list structure', () => {
        render(results());

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        render(results({ onSelectRecipe }));

        await user.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('mounts the create dial over populated results, wired to both destinations', async () => {
        const user = userEvent.setup();
        const onPasteIngredients = vi.fn();
        render(results({ onPasteIngredients }));

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListResults (web) — a TRUE empty library', () => {
    it('shows the empty message, and neither a count nor rows', () => {
        render(results({ recipes: [] }));

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.queryByText('0 recipes')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('offers exactly ONE create affordance — the empty-state CTA, never a second floating dial', () => {
        render(results({ recipes: [] }));

        expect(screen.getAllByRole('button', { name: /Create your first recipe|New recipe/ })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('wires the empty-state CTA to the create handler', async () => {
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        render(results({ recipes: [], onCreateRecipe }));

        await user.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListResults (web) — a NARROWED zero (no-match)', () => {
    it('shows the no-match copy, NOT the empty copy — the caller has recipes', () => {
        render(results({ recipes: [], narrowed: true }));

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });

    it('offers no first-run create CTA, and KEEPS the dial, whose body has no CTA to replace it', () => {
        render(results({ recipes: [], narrowed: true }));

        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });
});

describe('RecipeListResults (web) — quick-filter chips (L4)', () => {
    const chips = (overrides: Partial<NonNullable<RecipeListResultsProps['filters']>> = {}) =>
        results({
            filters: { available: ['Vegetarian', 'Italian'], active: [], onToggle: noop, onClear: noop, ...overrides },
        });

    it('renders no chip row when no filters prop is given', () => {
        render(results());

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    });

    it('renders no chip row when no facet is available', () => {
        render(chips({ available: [] }));

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    });

    it('renders one chip per available facet, marking active ones pressed', () => {
        render(chips({ active: ['Italian'] }));

        const group = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(group).getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('false');
        expect(within(group).getByRole('button', { name: 'Italian' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('renders a leading "All" chip, pressed exactly when no facet is active, that clears the filters', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        render(chips({ active: ['Vegetarian'], onClear }));

        const group = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(group).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');

        await user.click(within(group).getByRole('button', { name: 'All' }));
        expect(onClear).toHaveBeenCalledTimes(1);

        cleanup();
        render(chips());
        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('reports a chip toggle upward with the facet value', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(chips({ onToggle }));

        await user.click(screen.getByRole('button', { name: 'Vegetarian' }));

        expect(onToggle).toHaveBeenCalledWith('Vegetarian');
    });

    it('renders the QUICK_TIME_FACET sentinel as the localized "Quick (<30m)" label, not the raw token', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(chips({ available: ['quick', 'Italian'], onToggle }));

        expect(screen.queryByRole('button', { name: 'quick' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Quick (<30m)' }));

        // Toggling still reports the underlying sentinel token upward, not the display label.
        expect(onToggle).toHaveBeenCalledWith('quick');
    });

    it('gives every chip the 44px touch floor and a taller base tap target, reset to desktop density at md (U5)', () => {
        render(chips({ active: ['Italian'] }));

        const group = screen.getByRole('group', { name: 'Quick filters' });

        for (const name of ['All', 'Vegetarian', 'Italian']) {
            const chip = within(group).getByRole('button', { name });
            expect(chip.className).toContain('min-h-11');
            expect(chip.className).toContain('md:min-h-0');
            expect(chip.className).toContain('py-1.5');
            expect(chip.className).toContain('md:py-1');
        }
    });
});

describe('RecipeListResults (web) — a failed refresh of the rows on screen', () => {
    const notice = (overrides: Partial<NonNullable<RecipeListResultsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    it('shows no notice while nothing has failed', () => {
        render(results({ refreshNotice: notice() }));

        expect(screen.queryByText('We couldn’t refresh your recipes.')).toBeNull();
    });

    it('⛔ keeps the rows and says the refresh failed, with a Try again that retries', () => {
        const onRetry = vi.fn();
        render(results({ refreshNotice: notice({ failed: true, onRetry }) }));

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('We couldn’t refresh your recipes.');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListResults (web) — the deferred calorie figure', () => {
    it('asks the host for each visible card’s figure by recipe id, and renders what it returns', () => {
        const renderNutrition = vi.fn((recipeId: string) => <span>{`kcal for ${recipeId}`}</span>);
        render(results({ renderNutrition }));

        expect(renderNutrition.mock.calls.map(([recipeId]) => recipeId)).toEqual(['rec_1', 'rec_2', 'rec_3']);
        expect(screen.getByText('kcal for rec_2')).toBeTruthy();
    });
});
