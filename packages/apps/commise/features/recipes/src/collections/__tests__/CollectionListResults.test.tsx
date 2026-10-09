// @vitest-environment jsdom
/**
 * Component tests for the web collection-list RESULTS — what renders inside the list's suspense boundary once the read
 * has settled: the refresh notice, the empty state or the rows, and the server-paged load-more control.
 *
 * Moved from the retired `CollectionList.test.tsx` ("empty state", "populated state", the name's contrast, "load-more"
 * and "a failed refresh"). The heading's focus move went to `CollectionListFrame.test.tsx`, which now owns the heading.
 *
 * ⚠️ REWRITTEN in part for slice 4 (`docs/design/uiOverhaul/buildSpec.md` §5.1): the first run, the count, the album
 * card named "{name}, {visibility}" with its copy credit, the two-column grid and the search from six collections. The
 * card is a level-1 card in roles now, so the hover colour-shift (and its contrast test) is gone with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@commise/i18n/react';
import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionListResults } from '../CollectionListResults.js';
import type { CollectionListResultsProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderList(overrides: Partial<CollectionListResultsProps> = {}) {
    const props: CollectionListResultsProps = {
        collections: [],
        total: overrides.collections?.length ?? 0,
        onSelect: noop,
        search: { value: '', onChange: noop },
        firstRun: { hasRecipes: true, onCreate: noop, onAddRecipe: noop },
        ...overrides,
    };
    render(
        <LocaleProvider locale="en">
            <CollectionListResults {...props} />
        </LocaleProvider>,
    );

    return props;
}

const threeCollections = [
    makeCollection({ id: 'col_1', name: 'Weeknight Dinners', visibility: 'private' }),
    makeCollection({ id: 'col_2', name: 'Holiday Baking', visibility: 'public' }),
    makeCollection({ id: 'col_3', name: 'Meal Prep', visibility: 'private' }),
];

describe('CollectionListResults (web) — the first run', () => {
    it('invites the first collection, with New collection', async () => {
        const onCreate = vi.fn();
        renderList({ firstRun: { hasRecipes: true, onCreate, onAddRecipe: noop } });

        expect(screen.getByRole('heading', { level: 2, name: 'Group recipes your way' })).toBeTruthy();
        expect(screen.getByText('Make a collection for weeknights, holidays or anything else.')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('with no recipes yet, asks for a few first and offers Add a recipe instead', async () => {
        const onAddRecipe = vi.fn();
        renderList({ firstRun: { hasRecipes: false, onCreate: noop, onAddRecipe } });

        expect(screen.getByText('Add a few recipes first.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New collection' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionListResults (web) — populated state', () => {
    it('says how many collections there are, and draws one card each', () => {
        renderList({ collections: threeCollections });

        expect(screen.getByText('3 collections')).toBeTruthy();
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    });

    it('names each card by its name and its visibility, said with a word beside its glyph', () => {
        renderList({ collections: threeCollections });

        expect(screen.getByRole('article', { name: 'Weeknight Dinners, Private' })).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Holiday Baking, Public' })).toBeTruthy();
        expect(
            within(screen.getByRole('article', { name: 'Holiday Baking, Public' })).getByText('Public'),
        ).toBeTruthy();
    });

    it('credits a copy to its source', () => {
        renderList({
            collections: [{ ...makeCollection({ id: 'col_9', name: 'Borrowed' }), sourceOwnerHandle: 'clara' }],
        });

        expect(screen.getByText('Copied from @clara')).toBeTruthy();
    });

    it('makes each card one link when the host gives an href, reporting a plain click', async () => {
        const onSelect = vi.fn();
        renderList({ collections: threeCollections, onSelect, hrefOf: (id) => `/en/collections/${id}` });

        const link = screen.getByRole('link', { name: 'Holiday Baking' });
        expect(link.getAttribute('href')).toBe('/en/collections/col_2');

        await userEvent.click(link);

        expect(onSelect).toHaveBeenCalledWith('col_2');
    });

    it('lays the cards out two to a row on a phone and auto-fill from 600', () => {
        renderList({ collections: threeCollections });
        const list = screen.getByRole('list');

        expect(list.className).toContain('grid-cols-2');
        expect(list.className).toContain('@regular/main:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]');
    });
});

describe('CollectionListResults (web) — the search', () => {
    const six = Array.from({ length: 6 }, (_unused, index) => makeCollection({ id: `c${index}`, name: `C ${index}` }));

    it('shows from six collections only', () => {
        renderList({ collections: threeCollections });
        expect(screen.queryByRole('searchbox')).toBeNull();
        cleanup();

        renderList({ collections: six });
        expect(screen.getByRole('searchbox', { name: 'Search your collections' })).toBeTruthy();
    });

    it('reports a search, and says when nothing matches it', () => {
        const onChange = vi.fn();
        renderList({ collections: [], total: 6, search: { value: 'zzz', onChange } });

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search your collections' }), {
            target: { value: 'z' },
        });

        expect(onChange).toHaveBeenCalledWith('z');
        expect(screen.getByText('No collections match “zzz”.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Group recipes your way' })).toBeNull();
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
        return (
            <CollectionListResults
                collections={threeCollections}
                total={threeCollections.length}
                onSelect={noop}
                search={{ value: '', onChange: noop }}
                firstRun={{ hasRecipes: true, onCreate: noop, onAddRecipe: noop }}
                refreshNotice={refreshNotice}
            />
        );
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
