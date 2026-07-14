/**
 * Native component tests for the collection-list view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across EVERY state — loading, error, empty, populated — plus the persistent chrome and the
 * interaction contracts, so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type { Collection } from '@kitchensink/recipe-core';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionList } from '../CollectionList.native.js';
import type { CollectionListViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight Dinners',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

function renderList(overrides: Partial<CollectionListViewProps> = {}) {
    const props: CollectionListViewProps = {
        status: 'ready',
        collections: [],
        onSelect: noop,
        onCreate: noop,
        onRetry: noop,
        ...overrides,
    };
    render(<CollectionList {...props} />);

    return props;
}

const threeCollections = [
    makeCollection({ id: 'col_1', name: 'Weeknight Dinners' }),
    makeCollection({ id: 'col_2', name: 'Holiday Baking' }),
    makeCollection({ id: 'col_3', name: 'Meal Prep', description: 'Batch-cook staples.' }),
];

describe('CollectionList (native) — chrome', () => {
    it('always renders the heading and create action', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
    });

    it('reports create requests upward', () => {
        const onCreate = vi.fn();
        renderList({ onCreate });

        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionList (native) — loading state', () => {
    it('shows the loading label and no collection rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weeknight Dinners' })).toBeNull();
    });
});

describe('CollectionList (native) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionList (native) — empty state', () => {
    it('shows the empty message when a successful load returns no collections', () => {
        renderList({ status: 'ready', collections: [] });

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });
});

describe('CollectionList (native) — populated state', () => {
    it('renders one button per collection and reports selection upward', () => {
        const onSelect = vi.fn();
        renderList({ status: 'ready', collections: threeCollections, onSelect });

        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Holiday Baking' }));
        expect(onSelect).toHaveBeenCalledWith('col_2');
    });

    it('renders a collection description when present', () => {
        renderList({ status: 'ready', collections: threeCollections });

        expect(screen.getByText('Batch-cook staples.')).toBeTruthy();
    });
});
