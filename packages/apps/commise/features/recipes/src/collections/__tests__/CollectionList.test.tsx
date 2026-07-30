// @vitest-environment jsdom
/**
 * Component tests for the web collection-list view. Covers EVERY UI state the testing mandate requires —
 * loading, error, empty, and populated — plus the persistent chrome (heading, create) and the interaction
 * contracts (select, create, retry). Assertions are on role/name/text and on mock-call arguments, so a
 * wrong state branch or a dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { utilityContrast } from '@commise/test-utils';
import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionList } from '../CollectionList.js';
import type { CollectionListViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

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

    it('reports create requests upward', async () => {
        const user = userEvent.setup();
        const onCreate = vi.fn();
        renderList({ onCreate });

        await user.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionList (web) — loading state', () => {
    it('shows a busy status and no collection rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weeknight Dinners' })).toBeNull();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        renderList({ status: 'loading' });

        // A `role="status"` node rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted
        // viewer, and Playwright resolves it as `hidden`) AND it is silent, because a live region announces
        // its CONTENT, not its label. The label must therefore be the visible caption.
        expect(screen.getByRole('status').textContent).toContain('Loading collections');
    });
});

describe('CollectionList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
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

    it('reports the selected collection id upward', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderList({ status: 'ready', collections: threeCollections, onSelect });

        await user.click(screen.getByRole('button', { name: 'Holiday Baking' }));

        expect(onSelect).toHaveBeenCalledWith('col_2');
    });
});

/**
 * The card's hover colour-shift is a TEXT colour, and the collection name is the thing a reader reads. At
 * 20px/600 it is NOT WCAG "large text" (which needs 18.66px BOLD, i.e. ≥700), so the 4.5:1 body floor applies
 * to the hovered state exactly as it does at rest. `group-hover:text-seafoam` scored 4.02:1 on the white card —
 * so pointing at a card made its own title HARDER to read, which is the inverse of the affordance's intent.
 *
 * Both states are measured off the rendered class list, so neither the resting `text-charcoal` nor the hover
 * colour can drift under the floor, and a re-theme of either token moves the test with it.
 */
describe('CollectionList (web) — the collection name clears the AA body-text floor in BOTH states', () => {
    it('keeps the collection name legible at rest AND while its card is hovered', () => {
        renderList({ status: 'ready', collections: threeCollections });
        const name = within(screen.getByRole('button', { name: 'Weeknight Dinners' })).getByText('Weeknight Dinners');

        expect(utilityContrast(name.className), 'collection name at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(name.className, { variant: 'group-hover' }),
            'collection name on card hover',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('CollectionList (web) — server-paged load-more (W5/C7)', () => {
    it('renders a load-more control when another page exists and reports activation upward', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore },
        });

        await user.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('renders no load-more control when the grouped loadMore prop is absent', () => {
        renderList({ status: 'ready', collections: threeCollections });

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('renders no load-more control when there is no next page', () => {
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: false, loading: false, onLoadMore: noop },
        });

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('disables and marks the load-more control busy while the next page is fetching', () => {
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop },
        });

        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button.hasAttribute('disabled')).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
    });
});
