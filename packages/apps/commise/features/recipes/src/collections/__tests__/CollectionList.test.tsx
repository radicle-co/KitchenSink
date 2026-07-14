// @vitest-environment jsdom
/**
 * Component tests for the web collection-list view. Covers EVERY UI state the testing mandate requires —
 * loading, error, empty, and populated — plus the persistent chrome (heading, create) and the interaction
 * contracts (select, create, retry). Assertions are on role/name/text and on mock-call arguments, so a
 * wrong state branch or a dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type { Collection } from '@kitchensink/recipe-core';

import { CollectionList } from '../CollectionList.js';
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

describe('CollectionList (web) — chrome', () => {
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

describe('CollectionList (web) — loading state', () => {
    it('shows a busy status and no collection rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weeknight Dinners' })).toBeNull();
    });
});

describe('CollectionList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render collection rows in the error state', () => {
        renderList({ status: 'error', collections: threeCollections });

        expect(screen.queryByRole('button', { name: 'Weeknight Dinners' })).toBeNull();
    });
});

describe('CollectionList (web) — empty state', () => {
    it('shows the empty message when a successful load returns no collections', () => {
        renderList({ status: 'ready', collections: [] });

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });

    it('renders no list when empty', () => {
        renderList({ status: 'ready', collections: [] });

        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('CollectionList (web) — populated state', () => {
    it('renders one row per collection in a list structure', () => {
        renderList({ status: 'ready', collections: threeCollections });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holiday Baking' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Meal Prep' })).toBeTruthy();
    });

    it('renders a collection description when present', () => {
        renderList({ status: 'ready', collections: threeCollections });

        expect(screen.getByText('Batch-cook staples.')).toBeTruthy();
    });

    it('reports the selected collection id upward', () => {
        const onSelect = vi.fn();
        renderList({ status: 'ready', collections: threeCollections, onSelect });

        fireEvent.click(screen.getByRole('button', { name: 'Holiday Baking' }));

        expect(onSelect).toHaveBeenCalledWith('col_2');
    });
});
