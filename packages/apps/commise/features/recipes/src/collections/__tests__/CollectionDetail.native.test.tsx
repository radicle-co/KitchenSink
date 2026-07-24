/**
 * Native component tests for the collection-detail view (rendered via react-native-web under jsdom).
 * Mirrors the web leaf across every branch — header (name, description, rename/delete), member recipe rows
 * (select + remove per row), and the empty state — so the two platform renders cannot drift.
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
        onRename: noop,
        onDelete: noop,
        ...overrides,
    };
    render(<CollectionDetail {...props} />);

    return props;
}

describe('CollectionDetail (native) — header', () => {
    it('renders the collection name as a heading', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ name: 'Holiday Baking' }) });

        expect(screen.getByRole('heading', { name: 'Holiday Baking' })).toBeTruthy();
    });

    it('renders the description when present', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ description: 'Cozy cold-weather bakes.' }) });

        expect(screen.getByText('Cozy cold-weather bakes.')).toBeTruthy();
    });

    it('reports rename and delete requests upward', () => {
        const onRename = vi.fn();
        const onDelete = vi.fn();
        renderDetail({ onRename, onDelete });

        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});

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
