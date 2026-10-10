/**
 * Native component tests for the collection-list RESULTS — inside the suspense boundary once the read has settled.
 * Moved from the retired `CollectionList.native.test.tsx` ("pull-to-refresh", "empty", "populated", "load-more" and
 * "a failed refresh"). Its "never busies the New collection action" guard is now structural: the create action lives
 * in the frame, which never receives the load-more state at all.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionListResults } from '../CollectionListResults.native.js';
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
    makeCollection({ id: 'col_2', name: 'Holiday Baking', visibility: 'private' }),
    makeCollection({ id: 'col_3', name: 'Meal Prep', visibility: 'private' }),
];

describe('CollectionListResults (native) — pull-to-refresh (U4/L8)', () => {
    it('still renders the populated rows when a refresh control is wired (RefreshControl is inert in jsdom)', () => {
        // The pull gesture + spinner are a device/Maestro concern; this guards that wiring the control through
        // the virtualized list does not break the body.
        renderList({
            collections: threeCollections,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(screen.getByRole('link', { name: 'Weeknight Dinners, Private' })).toBeTruthy();
    });
});

describe('CollectionListResults (native) — the first run (slice 4, `buildSpec.md` §5.1)', () => {
    it('invites the first collection, with New collection', () => {
        const onCreate = vi.fn();
        renderList({ firstRun: { hasRecipes: true, onCreate, onAddRecipe: noop } });

        expect(screen.getByText('Group recipes your way')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('with no recipes yet, offers Add a recipe instead', () => {
        const onAddRecipe = vi.fn();
        renderList({ firstRun: { hasRecipes: false, onCreate: noop, onAddRecipe } });

        expect(screen.getByText('Add a few recipes first.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionListResults (native) — populated state', () => {
    it('says the count, and draws one link per collection named by its name and visibility', () => {
        const onSelect = vi.fn();
        renderList({ collections: threeCollections, onSelect });

        expect(screen.getByText('3 collections')).toBeTruthy();

        fireEvent.click(screen.getByRole('link', { name: 'Holiday Baking, Private' }));
        expect(onSelect).toHaveBeenCalledWith('col_2');
    });

    it('credits a copy, and shows the search from six collections', () => {
        const six = Array.from({ length: 6 }, (_unused, index) => ({
            ...makeCollection({ id: `c${index}`, name: `C ${index}` }),
            sourceOwnerHandle: 'clara',
        }));
        renderList({ collections: six });

        expect(screen.getAllByText('Copied from @clara')).toHaveLength(6);
        expect(screen.getByLabelText('Search your collections')).toBeTruthy();
    });
});

describe('CollectionListResults (native) — server-paged load-more (W5/C7)', () => {
    it('renders a load-more control when another page exists and reports activation upward', () => {
        const onLoadMore = vi.fn();
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore, failed: false },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('⛔ a failed NEXT page keeps the loaded collections and offers Try again beside the reason', () => {
        const onLoadMore = vi.fn();
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, failed: true, onLoadMore },
        });

        expect(screen.getByText('Weeknight Dinners')).toBeTruthy();
        expect(screen.getByText('We couldn’t load more collections.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
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

    it('disables the load-more control and swaps its label while the next page is fetching', () => {
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop, failed: false },
        });

        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button.hasAttribute('disabled')).toBe(true);
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    /**
     * The load-more control's BUSY state has to reach the DOM as well as the device (#123).
     *
     * Verified against the installed react-native-web (0.20.0): its `forwardedProps` allowlist carries every
     * literal `aria-*` attribute but has NO entry that projects `accessibilityState` — the only consumer
     * anywhere in the package is `AccessibilityUtil/isDisabled`, and even that reads the LEGACY
     * `accessibilityStates` array. The `disabled` half already reached the DOM (RNW derives `aria-disabled` from
     * the `disabled` PROP, asserted above), so the in-flight page fetch was announced as "unavailable" rather
     * than "working". The label does swap to "Loading…", which IS announced here (this control has no explicit
     * `accessibilityLabel` override on its text) — but a name change is not a state, and it does not tell a
     * screen reader the region is mid-update.
     *
     * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it
     * is device-correct too, and the object form stays (RN reverse-maps `aria-busy` into
     * `accessibilityState.busy`). It is omitted when idle, since ARIA already defaults `aria-busy` to false.
     */
    it('marks the fetching load-more control busy in the DOM, not only disabled', () => {
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop, failed: false },
        });

        expect(screen.getByRole('button', { name: 'Loading…' }).getAttribute('aria-busy')).toBe('true');
    });

    it('leaves the idle load-more control unmarked, and distinguishable from disabled', () => {
        renderList({
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore: noop, failed: false },
        });

        const button = screen.getByRole('button', { name: 'Load more' });
        expect(button.getAttribute('aria-busy')).toBeNull();
        expect(button.hasAttribute('disabled')).toBe(false);
    });
});

describe('CollectionListResults (native) — a failed refresh of the rows on screen', () => {
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

/** A scroll host's bind that records what its scroller does with it. */
function recordingBind() {
    return {
        ref: vi.fn(),
        onScroll: vi.fn(),
        onScrollBeginDrag: vi.fn(),
        onMomentumScrollEnd: vi.fn(),
        scrollEventThrottle: 16 as const,
    };
}

/** The node the bind's ref was last handed. */
function boundScroller(bind: ReturnType<typeof recordingBind>): Element {
    const node: unknown = bind.ref.mock.calls.at(-1)?.[0];

    if (!(node instanceof Element)) {
        throw new Error('the scroller never took the bind');
    }

    return node;
}

/**
 * The screen's ONE vertical scroller takes its scroll host's bind (blueprint A7), so the host reads the scroll — the
 * floating create button shrinks as the cook scrolls down, and a second tap on the tab returns to the top.
 */
describe("CollectionListResults (native) — the scroll host's bind", () => {
    it("binds its scroller to the screen's scroll host, and reports each scroll to it", () => {
        const bind = recordingBind();
        renderList({ collections: threeCollections, total: 3, scrollBind: bind });

        fireEvent.scroll(boundScroller(bind), { target: { scrollTop: 240 } });

        expect(bind.onScroll).toHaveBeenCalled();
    });
});
