/**
 * Native component tests for the recipe-list view (rendered via react-native-web under jsdom). Mirrors the
 * web leaf across EVERY state — loading, error, empty, populated — plus the persistent chrome and the
 * interaction contracts, so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeList } from '../RecipeList.native.js';
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

describe('RecipeList (native) — chrome', () => {
    it('always renders the heading, search field, and create action', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderList({ onSearchChange });

        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('reports create requests upward from the FAB', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — create FAB (L1)', () => {
    it('renders the create control as a FAB OUTSIDE the header row', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        const header = screen.getByRole('heading', { name: 'Recipes' }).parentElement as HTMLElement;
        expect(within(header).queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('keeps the FAB present across loading, error, and populated states', () => {
        for (const state of ['loading', 'error', 'ready'] as const) {
            cleanup();
            renderList({ status: state, recipes: state === 'ready' ? threeRecipes : [] });
            expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        }
    });

    it('suppresses the FAB in the empty state, where the empty CTA is the sole create control', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });

    it('wires the empty-state CTA to the create handler', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: [], onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — loading state', () => {
    it('shows the loading label and no recipe rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeList (native) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — empty state', () => {
    it('shows the empty message when a successful load returns no recipes', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
    });
});

describe('RecipeList (native) — no-match state', () => {
    it('shows the no-match copy (NOT the empty copy) when a search filters every row out', () => {
        renderList({ status: 'ready', recipes: [], searchValue: 'zzz' });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });
});

describe('RecipeList (native) — populated state', () => {
    it('renders a pluralized result count', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('renders one button per recipe and reports selection upward', () => {
        const onSelectRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onSelectRecipe });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });
});
