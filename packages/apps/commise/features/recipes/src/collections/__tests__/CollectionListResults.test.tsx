// @vitest-environment jsdom
/**
 * Component tests for the web collection-list RESULTS — what renders inside the list's suspense boundary once the read
 * has settled: the refresh notice, the empty state or the rows, and the server-paged load-more control.
 *
 * Moved from the retired `CollectionList.test.tsx` ("empty state", "populated state", the name's contrast, "load-more"
 * and "a failed refresh"). The heading's focus move went to `CollectionListFrame.test.tsx`, which now owns the heading.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { utilityContrast } from '@commise/test-utils';
import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionListResults } from '../CollectionListResults.js';
import type { CollectionListResultsProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderList(overrides: Partial<CollectionListResultsProps> = {}) {
    const props: CollectionListResultsProps = {
        collections: [],
        onSelect: noop,
        ...overrides,
    };
    render(<CollectionListResults {...props} />);

    return props;
}

const threeCollections = [
    makeCollection({ id: 'col_1', name: 'Weeknight Dinners' }),
    makeCollection({ id: 'col_2', name: 'Holiday Baking' }),
    makeCollection({ id: 'col_3', name: 'Meal Prep', description: 'Batch-cook staples.' }),
];

describe('CollectionListResults (web) — empty state', () => {
    it('shows the empty message when a successful load returns no collections', () => {
        renderList({ collections: [] });

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });

    it('renders no list when empty', () => {
        renderList({ collections: [] });

        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('CollectionListResults (web) — populated state', () => {
    it('renders one row per collection in a list structure', () => {
        renderList({ collections: threeCollections });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holiday Baking' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Meal Prep' })).toBeTruthy();
    });

    it('renders a collection description when present', () => {
        renderList({ collections: threeCollections });

        expect(screen.getByText('Batch-cook staples.')).toBeTruthy();
    });

    it('reports the selected collection id upward', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderList({ collections: threeCollections, onSelect });

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
describe('CollectionListResults (web) — the collection name clears the AA body-text floor in BOTH states', () => {
    it('keeps the collection name legible at rest AND while its card is hovered', () => {
        renderList({ collections: threeCollections });
        const name = within(screen.getByRole('button', { name: 'Weeknight Dinners' })).getByText('Weeknight Dinners');

        expect(utilityContrast(name.className), 'collection name at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(name.className, { variant: 'group-hover' }),
            'collection name on card hover',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('CollectionListResults (web) — server-paged load-more (W5/C7)', () => {
    it('renders a load-more control when another page exists and reports activation upward', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore, failed: false },
        });

        await user.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('⛔ a failed NEXT page keeps the loaded collections and offers Try again beside the reason', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, failed: true, onLoadMore },
        });

        expect(screen.getByText('Weeknight Dinners')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load more collections.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('renders no load-more control when the grouped loadMore prop is absent', () => {
        renderList({ collections: threeCollections });

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('renders no load-more control when there is no next page', () => {
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: false, loading: false, onLoadMore: noop, failed: false },
        });

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    /** REWRITTEN from native `disabled`: the pressed Load more keeps focus while busy, and refuses a second fetch. */
    it('busies the load-more control while the next page is fetching, keeping it focusable', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore, failed: false },
        });

        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button.hasAttribute('disabled')).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.getAttribute('aria-busy')).toBe('true');

        await user.click(button);
        expect(onLoadMore).not.toHaveBeenCalled();
    });
});

describe('CollectionListResults (web) — a failed refresh of the rows on screen', () => {
    const notice = (overrides: Partial<NonNullable<CollectionListResultsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    function viewWith(refreshNotice: CollectionListResultsProps['refreshNotice']) {
        return <CollectionListResults collections={threeCollections} onSelect={noop} refreshNotice={refreshNotice} />;
    }

    it('shows no notice while nothing has failed', () => {
        render(viewWith(notice()));

        expect(screen.queryByText('We couldn’t refresh your collections.')).toBeNull();
    });

    it('⛔ keeps the rows and says the refresh failed, with a Try again that retries', () => {
        const onRetry = vi.fn();
        render(viewWith(notice({ failed: true, onRetry })));

        expect(screen.getAllByText('Weeknight Dinners').length).toBeGreaterThan(0);
        expect(screen.getAllByText('We couldn’t refresh your collections.').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
