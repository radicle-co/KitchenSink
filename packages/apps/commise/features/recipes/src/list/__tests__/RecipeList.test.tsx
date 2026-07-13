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

    it('reports create requests upward', () => {
        const onCreateRecipe = vi.fn();
        renderList({ onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
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
