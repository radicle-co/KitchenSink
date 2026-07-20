// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list view. Covers EVERY UI state the testing mandate requires —
 * loading, error, empty, and populated — plus the persistent chrome (heading, search, create) and the
 * interaction contracts (search change, select, create, retry). Assertions are on role/name/text and on
 * mock-call arguments, so a wrong state branch or a dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeList } from '../RecipeList.js';
import type { RecipeListViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderList(overrides: Partial<RecipeListViewProps> = {}) {
    const props: RecipeListViewProps = {
        status: 'ready',
        recipes: [],
        searchValue: '',
        onSearchChange: noop,
        onSelectRecipe: noop,
        onCreateRecipe: noop,
        onRetry: noop,
        ...overrides,
    };
    render(<RecipeList {...props} />);
    return props;
}

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', totalTimeMinutes: 45 }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce', totalTimeMinutes: 20 }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad', totalTimeMinutes: 15 }),
];

describe('RecipeList (web) — chrome', () => {
    it('always renders the heading, search box, and create action', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('reflects the controlled search value', () => {
        renderList({ searchValue: 'risotto' });

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderList({ onSearchChange });

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('reports create requests upward from the FAB', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (web) — create FAB (L1)', () => {
    it('renders the create control as a pinned FAB OUTSIDE the header', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        const fab = screen.getByRole('button', { name: 'New recipe' });
        // Position isn't queryable in jsdom; assert the pinned-FAB class contract + that it is not chrome.
        expect(fab.className).toContain('fixed');
        expect(fab.closest('header')).toBeNull();
    });

    it('keeps the FAB present across loading, error, and populated states', () => {
        for (const state of ['loading', 'error', 'ready'] as const) {
            cleanup();
            renderList({ status: state, recipes: state === 'ready' ? threeRecipes : [] });
            expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        }
    });

    it('suppresses the FAB in the empty state, where the empty-state CTA is the sole create control', () => {
        renderList({ status: 'ready', recipes: [] });

        // Exactly ONE create affordance on empty — the empty CTA, not a second floating FAB.
        const createButtons = screen.getAllByRole('button', { name: /Create your first recipe|New recipe/ });
        expect(createButtons).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });

    it('wires the empty-state CTA to the create handler', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: [], onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (web) — source tabs (L5)', () => {
    it('renders no tab control when no tab prop is given (backward compatible)', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('renders My Recipes / Community tabs with the active one selected', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            tab: { active: 'mine', onChange: noop },
        });

        expect(screen.getByRole('tab', { name: 'My Recipes' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Community' }).getAttribute('aria-selected')).toBe('false');
    });

    it('reports a tab change upward', () => {
        const onChange = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            tab: { active: 'mine', onChange },
        });

        fireEvent.click(screen.getByRole('tab', { name: 'Community' }));

        expect(onChange).toHaveBeenCalledWith('community');
    });

    it('shows the distinct Community empty copy and NO FAB on the Community tab', () => {
        renderList({
            status: 'ready',
            recipes: [],
            tab: { active: 'community', onChange: noop },
        });

        expect(screen.getByText('No community recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
        // FAB is My-Recipes-only — you never create into the community list.
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });
});

describe('RecipeList (web) — quick-filter chips (L4)', () => {
    it('renders no chip row when no filters prop is given (backward compatible)', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    });

    it('renders one chip per available facet, marking active ones pressed', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['vegetarian', 'quick'], active: ['quick'], onToggle: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(chips).getByRole('button', { name: 'vegetarian' }).getAttribute('aria-pressed')).toBe('false');
        expect(within(chips).getByRole('button', { name: 'quick' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('reports a chip toggle upward with the facet value', () => {
        const onToggle = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['vegetarian'], active: [], onToggle },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        fireEvent.click(within(chips).getByRole('button', { name: 'vegetarian' }));

        expect(onToggle).toHaveBeenCalledWith('vegetarian');
    });
});

describe('RecipeList (web) — loading state', () => {
    it('shows a busy status and no recipe rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render recipe rows in the error state', () => {
        renderList({ status: 'error', recipes: threeRecipes });

        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeList (web) — empty state', () => {
    it('shows the empty message when a successful load returns no recipes', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
    });

    it('renders neither a count nor rows when empty', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.queryByText('0 recipes')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('RecipeList (web) — no-match state', () => {
    it('shows the no-match copy (NOT the empty copy) when a search filters every row out', () => {
        // The caller HAS recipes; an active term filtered them all out. Showing "No recipes yet" here would
        // be the empty-vs-no-match copy bug — assert the distinct no-match copy and the absence of the empty.
        renderList({ status: 'ready', recipes: [], searchValue: 'zzz' });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });

    it('shows the empty copy when there is no active search', () => {
        renderList({ status: 'ready', recipes: [], searchValue: '   ' });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
    });
});

describe('RecipeList (web) — populated state', () => {
    it('renders a pluralized result count', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('renders one card per recipe', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', () => {
        const onSelectRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onSelectRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders the rows in a list structure', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    });
});
