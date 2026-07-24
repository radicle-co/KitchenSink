/**
 * Native component tests for the collection member row (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across every state — source indicator, `by @handle`, card-composed fields, select/remove
 * reporting, and the mandatory double-fire guard — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionMemberRow } from '../CollectionMemberRow.native.js';
import type { CollectionMemberRowProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderRow(overrides: Partial<CollectionMemberRowProps> = {}) {
    const props: CollectionMemberRowProps = {
        member: makeCollectionMemberRecipe(),
        onSelect: noop,
        onRemove: noop,
        ...overrides,
    };
    render(<CollectionMemberRow {...props} />);

    return props;
}

describe('CollectionMemberRow (native) — source indicator', () => {
    it('shows the owner-added/protected indicator when addedVia is manual', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.MANUAL }) });

        expect(screen.getByText('Added by you')).toBeTruthy();
        expect(screen.queryByText('From source collection')).toBeNull();
    });

    it('shows the from-source/will-sync indicator when addedVia is clone_seed', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.CLONE_SEED }) });

        expect(screen.getByText('From source collection')).toBeTruthy();
        expect(screen.queryByText('Added by you')).toBeNull();
    });

    it('shows the from-source/will-sync indicator when addedVia is pull', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.PULL }) });

        expect(screen.getByText('From source collection')).toBeTruthy();
        expect(screen.queryByText('Added by you')).toBeNull();
    });
});

describe('CollectionMemberRow (native) — by @handle', () => {
    it('renders the by-@handle line when the member has an author handle', () => {
        renderRow({ member: makeCollectionMemberRecipe({ authorHandle: 'alexk' }) });

        expect(screen.getByText('by @alexk')).toBeTruthy();
    });

    it('omits the by-@handle line when the member has no author handle (never "by @undefined")', () => {
        renderRow({ member: makeCollectionMemberRecipe({ authorHandle: undefined }) });

        expect(screen.queryByText(/^by @/)).toBeNull();
    });
});

describe('CollectionMemberRow (native) — composes RecipeCard (not a hand-rolled duplicate)', () => {
    it('renders the title, version badge past v1, visibility, and calories via the shared RecipeCard', () => {
        renderRow({
            member: makeCollectionMemberRecipe({
                title: 'Chicken Alfredo',
                currentVersion: 3,
                visibility: 'private',
                status: 'published',
                leadCaloriesPerServing: 520,
            }),
        });

        expect(screen.getByText('Chicken Alfredo')).toBeTruthy();
        expect(screen.getByLabelText('Version 3').textContent).toBe('v3');
        expect(screen.getByText('Private')).toBeTruthy();
        expect(screen.getByText('520 cal')).toBeTruthy();
    });

    it('hides the version badge at v1 and renders no calorie line when calories are absent (never 0)', () => {
        renderRow({
            member: makeCollectionMemberRecipe({ currentVersion: 1, leadCaloriesPerServing: undefined }),
        });

        expect(screen.queryByLabelText(/Version/)).toBeNull();
        expect(screen.queryByText(/cal$/)).toBeNull();
        expect(screen.queryByText('0 cal')).toBeNull();
    });
});

describe('CollectionMemberRow (native) — select / remove', () => {
    it('reports the recipe id upward when the select target is activated', () => {
        const onSelect = vi.fn();
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), onSelect });

        fireEvent.click(screen.getByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelect).toHaveBeenCalledWith('rec_1');
    });

    it('reports the recipe id upward when the remove control is activated', () => {
        const onRemove = vi.fn();
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), onRemove });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemove).toHaveBeenCalledWith('rec_1');
    });

    it('does NOT also fire onSelect when Remove is activated (double-fire guard — sibling controls, never nested)', () => {
        const onSelect = vi.fn();
        const onRemove = vi.fn();
        renderRow({
            member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            onSelect,
            onRemove,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemove).toHaveBeenCalledWith('rec_1');
        expect(onSelect).not.toHaveBeenCalled();
    });
});
