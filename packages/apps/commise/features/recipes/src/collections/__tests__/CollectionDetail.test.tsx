// @vitest-environment jsdom
/**
 * Component tests for the web collection-detail view. Covers every branch T072 requires — the header
 * (name, description, rename/delete actions), the member recipe rows (select + remove per row), and the
 * empty state (a collection with no members) — asserting on role/name/text and mock-call arguments so a
 * dropped handler argument or a missing branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type { Collection } from '@kitchensink/recipe-core';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import { CollectionDetail } from '../CollectionDetail.js';
import type { CollectionDetailViewProps, CollectionWithRecipes } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function makeCollectionWithRecipes(overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes {
    const base: Collection = {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight Dinners',
        visibility: 'private',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
    };

    return {
        ...base,
        recipes: [
            makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            makeCollectionMemberRecipe({ id: 'rec_2', title: 'Sheet-Pan Chicken' }),
        ],
        ...overrides,
    };
}

function renderDetail(overrides: Partial<CollectionDetailViewProps> = {}) {
    const props: CollectionDetailViewProps = {
        collection: makeCollectionWithRecipes(),
        onSelectRecipe: noop,
        onRemoveRecipe: noop,
        onAddRecipe: noop,
        onRename: noop,
        onDelete: noop,
        ...overrides,
    };
    render(<CollectionDetail {...props} />);

    return props;
}

describe('CollectionDetail (web) — header', () => {
    it('renders the collection name as the top-level heading', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ name: 'Holiday Baking' }) });

        expect(screen.getByRole('heading', { level: 1, name: 'Holiday Baking' })).toBeTruthy();
    });

    it('renders the description when present', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ description: 'Cozy cold-weather bakes.' }) });

        expect(screen.getByText('Cozy cold-weather bakes.')).toBeTruthy();
    });

    it('reports rename requests upward', () => {
        const onRename = vi.fn();
        renderDetail({ onRename });

        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(onRename).toHaveBeenCalledTimes(1);
    });

    it('reports delete requests upward', () => {
        const onDelete = vi.fn();
        renderDetail({ onDelete });

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionDetail (web) — member recipes', () => {
    it('renders one row per member recipe', () => {
        renderDetail();

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sheet-Pan Chicken' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', () => {
        const onSelectRecipe = vi.fn();
        renderDetail({ onSelectRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Sheet-Pan Chicken' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('reports the removed recipe id upward from a per-row remove control', () => {
        const onRemoveRecipe = vi.fn();
        renderDetail({ onRemoveRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemoveRecipe).toHaveBeenCalledWith('rec_1');
    });

    it('reports an add-a-recipe request upward', () => {
        const onAddRecipe = vi.fn();
        renderDetail({ onAddRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionDetail (web) — empty state', () => {
    it('shows the empty message and no list when the collection has no members', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: [] }) });

        expect(screen.getByText('No recipes in this collection yet')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('treats an absent recipes field as empty', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: undefined }) });

        expect(screen.getByText('No recipes in this collection yet')).toBeTruthy();
    });
});

describe('CollectionDetail (web) — member-list windowing (W5/C7)', () => {
    const eightMembers = Array.from({ length: 8 }, (_, index) =>
        makeCollectionMemberRecipe({ id: `rec_${index + 1}`, title: `Recipe ${index + 1}` }),
    );

    it('renders only the first window and a templated load-more control when over the window size', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers }) });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(4);
        expect(screen.getByRole('button', { name: 'Recipe 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Recipe 4' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Recipe 5' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Load more (4 more)' })).toBeTruthy();
    });

    it('reveals the next window when the load-more control is activated', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers }) });

        fireEvent.click(screen.getByRole('button', { name: 'Load more (4 more)' }));

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(8);
        expect(screen.getByRole('button', { name: 'Recipe 8' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });

    it('renders no load-more control when the member count is within the window', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers.slice(0, 4) }) });

        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });
});

describe('CollectionDetail (web) — mutation error (B17: no frozen no-op)', () => {
    it('surfaces the delete-failed copy when a delete errored', () => {
        renderDetail({ error: 'delete' });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t delete this collection. Please try again.');
    });

    it('surfaces the remove-failed copy when a member removal errored', () => {
        renderDetail({ error: 'remove' });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t remove that recipe. Please try again.');
    });

    it('shows no alert when the last mutation did not fail', () => {
        renderDetail({ error: undefined });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
