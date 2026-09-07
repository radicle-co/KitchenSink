// @vitest-environment jsdom
/**
 * Component tests for the web collection-detail view — now the MEMBER LIST only (the header moved to
 * `CollectionHeader`, W5 Task 12). Covers every branch it renders: the member recipe rows (select + remove
 * per row), the add-a-recipe control, the empty state (a collection with no members), the client-side
 * reveal windowing (W5/C7), and the B17 delete/remove error banner — asserting on role/name/text and
 * mock-call arguments so a dropped handler argument or a missing branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
        ...overrides,
    };
    render(<CollectionDetail {...props} />);

    return props;
}

describe('CollectionDetail (web) — member recipes', () => {
    it('renders one row per member recipe', () => {
        renderDetail();

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sheet-Pan Chicken' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderDetail({ onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Sheet-Pan Chicken' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('reports the removed recipe id upward from a per-row remove control', async () => {
        const user = userEvent.setup();
        const onRemoveRecipe = vi.fn();
        renderDetail({ onRemoveRecipe });

        await user.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemoveRecipe).toHaveBeenCalledWith('rec_1');
    });

    it('reports an add-a-recipe request upward', async () => {
        const user = userEvent.setup();
        const onAddRecipe = vi.fn();
        renderDetail({ onAddRecipe });

        await user.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionDetail (web) — empty state', () => {
    it('shows the empty message and no list when the collection has no members', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: [] }) });

        expect(screen.getByText('No recipes in this collection yet')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });

    // There is deliberately NO "treats an absent recipes field as empty" case any more. `CollectionWithRecipes`
    // is now the published `CollectionWithRecipesResponse`, where `recipes` is REQUIRED — the server sets it
    // unconditionally, so an absent key is not a state it can produce, and the empty case above is the real
    // "nothing to show" state. The removed test only compiled by laundering `undefined` into a required field
    // through a `Partial` spread, which is exactly the drift the convergence removed.
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

    it('reveals the next window when the load-more control is activated', async () => {
        const user = userEvent.setup();
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers }) });

        await user.click(screen.getByRole('button', { name: 'Load more (4 more)' }));

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(8);
        expect(screen.getByRole('button', { name: 'Recipe 8' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });

    it('renders no load-more control when the member count is within the window', () => {
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: eightMembers.slice(0, 4) }) });

        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });

    it('windows a non-multiple member count — 6 members show the first 4 and a "Load more (2 more)" control', async () => {
        const user = userEvent.setup();
        const sixMembers = Array.from({ length: 6 }, (_, index) =>
            makeCollectionMemberRecipe({ id: `rec_${index + 1}`, title: `Recipe ${index + 1}` }),
        );
        renderDetail({ collection: makeCollectionWithRecipes({ recipes: sixMembers }) });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
        expect(screen.getByRole('button', { name: 'Load more (2 more)' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Load more (2 more)' }));

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
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
