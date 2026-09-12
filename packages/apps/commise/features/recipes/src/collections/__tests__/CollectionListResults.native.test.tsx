/**
 * Native component tests for the collection-list RESULTS — inside the suspense boundary once the read has settled.
 * Moved from the retired `CollectionList.native.test.tsx` ("pull-to-refresh", "empty", "populated", "load-more" and
 * "a failed refresh"). Its "never busies the New collection action" guard is now structural: the create action lives
 * in the frame, which never receives the load-more state at all.
 */
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

describe('CollectionListResults (native) — pull-to-refresh (U4/L8)', () => {
    it('still renders the populated rows when a refresh control is wired (RefreshControl is inert in jsdom)', () => {
        // The pull gesture + spinner are a device/Maestro concern; this guards that wiring the control through
        // the virtualized list does not break the body.
        renderList({
            collections: threeCollections,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();
    });
});

describe('CollectionListResults (native) — empty state', () => {
    it('shows the empty message when a successful load returns no collections', () => {
        renderList({ collections: [] });

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });
});

describe('CollectionListResults (native) — populated state', () => {
    it('renders one button per collection and reports selection upward', () => {
        const onSelect = vi.fn();
        renderList({ collections: threeCollections, onSelect });

        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Holiday Baking' }));
        expect(onSelect).toHaveBeenCalledWith('col_2');
    });

    it('renders a collection description when present', () => {
        renderList({ collections: threeCollections });

        expect(screen.getByText('Batch-cook staples.')).toBeTruthy();
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
