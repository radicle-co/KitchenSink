/**
 * Native component tests for the collection-detail view (rendered via react-native-web under jsdom).
 * Mirrors the web leaf — now the MEMBER LIST only (the header moved to `CollectionHeader`, W5 Task 12):
 * member recipe rows (select + remove per row), the add control, the empty state, the reveal windowing, and
 * the B17 error banner — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type { Collection } from '@kitchensink/recipe-core';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionDetail } from '../CollectionDetail.native.js';
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
        ...overrides,
    };
    render(<CollectionDetail {...props} />);

    return props;
}

describe('CollectionDetail (native) — member recipes', () => {
    it('renders a select and remove control per member and reports ids upward', () => {
        const onSelectRecipe = vi.fn();
        const onRemoveRecipe = vi.fn();
        renderDetail({ onSelectRecipe, onRemoveRecipe });

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Sheet-Pan Chicken' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');

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

describe('CollectionDetail (native) — empty state', () => {
    it('shows the empty message when the collection has no members', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: [] }) });

        expect(screen.getByText('No recipes in this collection yet')).toBeTruthy();
    });
});

describe('CollectionDetail (native) — member-list windowing (W5/C7)', () => {
    const eightMembers = Array.from({ length: 8 }, (_, index) =>
        makeCollectionMemberRecipe({ id: `rec_${index + 1}`, title: `Recipe ${index + 1}` }),
    );

    it('renders only the first window and a templated load-more control when over the window size', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers }) });

        expect(screen.getByRole('button', { name: 'Recipe 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Recipe 4' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Recipe 5' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Load more (4 more)' })).toBeTruthy();
    });

    it('reveals the next window when the load-more control is activated', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers }) });

        fireEvent.click(screen.getByRole('button', { name: 'Load more (4 more)' }));

        expect(screen.getByRole('button', { name: 'Recipe 8' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });

    it('renders no load-more control when the member count is within the window', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers.slice(0, 4) }) });

        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });

    it('windows a non-multiple member count — 6 members show the first 4 and a "Load more (2 more)" control', () => {
        const sixMembers = Array.from({ length: 6 }, (_, index) =>
            makeCollectionMemberRecipe({ id: `rec_${index + 1}`, title: `Recipe ${index + 1}` }),
        );
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: sixMembers }) });

        expect(screen.getByRole('button', { name: 'Recipe 4' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Recipe 5' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Load more (2 more)' }));

        expect(screen.getByRole('button', { name: 'Recipe 6' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });
});

describe('CollectionDetail (native) — mutation error (B17: no frozen no-op)', () => {
    it('surfaces the delete-failed copy when a delete errored', () => {
        renderDetail({ error: 'delete' });

        expect(screen.getByText('We couldn’t delete this collection. Please try again.')).toBeTruthy();
    });

    it('surfaces the remove-failed copy when a member removal errored', () => {
        renderDetail({ error: 'remove' });

        expect(screen.getByText('We couldn’t remove that recipe. Please try again.')).toBeTruthy();
    });

    it('shows no error text when the last mutation did not fail', () => {
        renderDetail({ error: undefined });

        expect(screen.queryByText(/couldn’t/)).toBeNull();
    });
});
