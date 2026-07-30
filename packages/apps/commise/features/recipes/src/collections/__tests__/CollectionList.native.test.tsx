/**
 * Native component tests for the collection-list view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across EVERY state — loading, error, empty, populated — plus the persistent chrome and the
 * interaction contracts, so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeCollection } from '@kitchensink/recipe-core/testing';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionList } from '../CollectionList.native.js';
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

    it('renders inert skeleton cards (not a blank view) while loading (U4)', () => {
        renderList({ status: 'loading' });

        const region = screen.getByLabelText('Loading collections');
        expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });
});

describe('CollectionList (native) — pull-to-refresh (U4/L8)', () => {
    it('still renders the populated rows when a refresh control is wired (RefreshControl is inert in jsdom)', () => {
        // The pull gesture + spinner are a device/Maestro concern; this guards that wiring the control through
        // the virtualized list does not break the body.
        renderList({
            status: 'ready',
            collections: threeCollections,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(screen.getByRole('button', { name: 'Weeknight Dinners' })).toBeTruthy();
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

describe('CollectionList (native) — server-paged load-more (W5/C7)', () => {
    it('renders a load-more control when another page exists and reports activation upward', () => {
        const onLoadMore = vi.fn();
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

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

    it('disables the load-more control and swaps its label while the next page is fetching', () => {
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop },
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
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop },
        });

        expect(screen.getByRole('button', { name: 'Loading…' }).getAttribute('aria-busy')).toBe('true');
    });

    it('leaves the idle load-more control unmarked, and distinguishable from disabled', () => {
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: false, onLoadMore: noop },
        });

        const button = screen.getByRole('button', { name: 'Load more' });
        expect(button.getAttribute('aria-busy')).toBeNull();
        expect(button.hasAttribute('disabled')).toBe(false);
    });

    it('never busies the New collection action while a page is fetching', () => {
        // Mutation guard: an unconditional `aria-busy` across the view's controls would pass the case above.
        renderList({
            status: 'ready',
            collections: threeCollections,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop },
        });

        expect(screen.getByRole('button', { name: 'New collection' }).getAttribute('aria-busy')).toBeNull();
    });
});
