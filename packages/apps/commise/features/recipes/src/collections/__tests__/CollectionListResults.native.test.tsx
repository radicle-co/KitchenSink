/**
 * Native component tests for the collection-list RESULTS — inside the suspense boundary once the read has settled.
 * Moved from the retired `CollectionList.native.test.tsx` ("pull-to-refresh", "empty", "populated", "load-more" and
 * "a failed refresh"). Its "never busies the New collection action" guard is now structural: the create action lives
 * in the frame, which never receives the load-more state at all.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ReactElement } from 'react';

import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionListResults } from '../CollectionListResults.native.js';
import { collectionMessages } from '../messages.js';
import type { CollectionListResultsProps } from '../model.js';
import { nativeTokens } from '@commise/ui/native';
import { render, renderWithTamagui } from '@commise/ui/testing/tamagui';

/** The window's width and text scale, when a test sets them: jsdom has a 1024 px window and a scale of 1. */
const dims = vi.hoisted(() => ({ width: undefined as number | undefined, fontScale: undefined as number | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => {
            const real = actual.useWindowDimensions();

            return { ...real, width: dims.width ?? real.width, fontScale: dims.fontScale ?? real.fontScale };
        },
    };
});

afterEach(() => {
    cleanup();
    dims.width = undefined;
    dims.fontScale = undefined;
});

const noop = () => undefined;

function renderList(overrides: Partial<CollectionListResultsProps> = {}, textScale?: number) {
    const props: CollectionListResultsProps = {
        collections: [],
        total: overrides.collections?.length ?? 0,
        onSelect: noop,
        search: { value: '', onChange: noop },
        firstRun: { hasRecipes: true, onAddRecipe: noop },
        ...overrides,
    };
    (textScale === undefined ? render : (ui: ReactElement) => renderWithTamagui(ui, 'light', textScale))(
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

// The floating "New collection" is drawn over the list's foot, so the list reserves its height and a gap (SC 2.4.11), the
// same in every state so it does not jump when the button appears or yields. ⚠️ NEW: the rows used to reserve only 20 px.
describe('CollectionListResults (native) — the foot reserved for the floating create button', () => {
    it('reserves FAB_RESERVED_BOTTOM_PX under the last row', () => {
        renderList({ collections: threeCollections });
        const row = screen.getByRole('link', { name: 'Meal Prep, Private' });
        const foot: string[] = [];

        // The scroller's content container is one of the item's ancestors; the item's own padding is not its foot.
        for (let node = row.parentElement; node !== null; node = node.parentElement) {
            foot.push(getComputedStyle(node).paddingBottom);
        }

        expect(foot).toContain(`${FAB_RESERVED_BOTTOM_PX}px`);
    });
});

// Designer rulings d and e (2026-11-02): the room follows the button's drawn height at the current text scale.
describe('CollectionListResults (native) — the end room follows the font scale', () => {
    it('reserves 98 px under the last row at 1.5x', () => {
        renderList({ collections: threeCollections }, 1.5);
        const row = screen.getByRole('link', { name: 'Meal Prep, Private' });
        const foot: string[] = [];

        for (let node = row.parentElement; node !== null; node = node.parentElement) {
            foot.push(getComputedStyle(node).paddingBottom);
        }

        expect(foot).toContain('98px');
        expect(foot).not.toContain(`${FAB_RESERVED_BOTTOM_PX}px`);
    });
});

describe('CollectionListResults (native) — the first run (slice 4, `buildSpec.md` §5.1)', () => {
    // REWRITTEN (designer, 2026-11-03): see the web twin. The first run draws no create button of its own; the frame floats it.
    it('invites the first collection in words and draws no create button of its own (the frame floats it)', () => {
        renderList();

        expect(screen.getByText('Group recipes your way')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New collection' })).toBeNull();
    });

    it('with no recipes yet, offers Add a recipe instead', () => {
        const onAddRecipe = vi.fn();
        renderList({ firstRun: { hasRecipes: false, onAddRecipe } });

        expect(screen.getByText('Add a few recipes first.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });
});

// Designer finding (qa-ios, accessibility-xxx-large): the Collections empty state was a plain View, so at the largest
// text size its 514 pt block filled the screen and "New collection" sat below the fold with no way to scroll to it. It
// is now a scroller that ends with the room the floating button needs, and its text is the design-system Text, which
// stops at its role's cap (C-1: a plain React Native Text has no cap on iOS and grows to about 3x).
describe('CollectionListResults (native) — the first run scrolls at the largest text size', () => {
    /** The nearest ancestor that scrolls vertically, or `null`. */
    function scrollerOf(element: HTMLElement): HTMLElement | null {
        for (let node = element.parentElement; node !== null; node = node.parentElement) {
            if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
                return node;
            }
        }

        return null;
    }

    it('puts the heading and the body inside a scroller, so they can be scrolled at the largest size', () => {
        renderList({ firstRun: { hasRecipes: true, onAddRecipe: noop } }, 3.1);

        expect(scrollerOf(screen.getByText('Group recipes your way'))).not.toBeNull();
        expect(scrollerOf(screen.getByText(collectionMessages.en.list.emptyBody))).not.toBeNull();
    });

    it('puts "Add a recipe" inside a scroller too, when there are no recipes yet', () => {
        renderList({ firstRun: { hasRecipes: false, onAddRecipe: noop } }, 3.1);

        expect(scrollerOf(screen.getByRole('button', { name: 'Add a recipe' }))).not.toBeNull();
    });

    it('ends the scroller with the room the floating New collection button needs', () => {
        renderList({ firstRun: { hasRecipes: true, onAddRecipe: noop } }, 3.1);
        const scroller = scrollerOf(screen.getByText('Group recipes your way'));
        const foot: string[] = [];

        // The scroller's content container is the child of the element that scrolls.
        for (
            let node = screen.getByText('Group recipes your way').parentElement;
            node !== null;
            node = node.parentElement
        ) {
            foot.push(getComputedStyle(node).paddingBottom);

            if (node.parentElement === scroller) {
                break;
            }
        }

        // REWRITTEN: the room follows the button's drawn height at the current text scale (designer rulings d and e), and the
        // button's label stops at 1.5x, so at the iOS maximum the room is the 1.5x one (98 px), not the 1x constant.
        expect(foot).toContain('98px');
    });

    it('stops the title at the display ceiling of 1.5x and the body at 2x at the iOS maximum (fontScale 3.1)', () => {
        renderList({ firstRun: { hasRecipes: true, onAddRecipe: noop } }, 3.1);
        const sizeOf = (element: HTMLElement): number => parseFloat(getComputedStyle(element).fontSize);

        expect(sizeOf(screen.getByRole('heading', { name: 'Group recipes your way' }))).toBe(
            nativeTokens.type.sectionTitle.fontSize * 1.5,
        );
        expect(sizeOf(screen.getByText(collectionMessages.en.list.emptyBody))).toBe(
            nativeTokens.type.body.fontSize * 2,
        );
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

    // REWRITTEN (designer, 2026-11-02): the search field is the FRAME's pinned one (`CollectionListFrame.native.test.tsx`), so the
    // results draw none of their own, whatever the count.
    it('credits a copy, and draws no search field of its own from six collections', () => {
        const six = Array.from({ length: 6 }, (_unused, index) => ({
            ...makeCollection({ id: `c${index}`, name: `C ${index}` }),
            sourceOwnerUsername: 'clara',
            sourceOwnerDisplayName: 'Clara Oswald',
        }));
        renderList({ collections: six });

        expect(screen.getAllByText('Copied from \u2068@clara\u2069 (\u2068Clara Oswald\u2069)')).toHaveLength(6);
        expect(screen.queryByLabelText('Search your collections')).toBeNull();
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
                firstRun={{ hasRecipes: true, onAddRecipe: noop }}
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

describe('CollectionListResults (native) — W-11: the card says how many recipes and shows the first photos', () => {
    const photo = (n: number): string => `https://cdn.example/photo-${String(n)}.jpg`;
    const withCard = (recipeCount: number | undefined, coverPhotoUrls: readonly string[] | undefined) => ({
        ...makeCollection({ id: 'col_1', name: 'Weeknight Dinners', visibility: 'private' }),
        ...(recipeCount === undefined ? {} : { recipeCount }),
        ...(coverPhotoUrls === undefined ? {} : { coverPhotoUrls }),
    });
    const photosIn = (element: HTMLElement): readonly (string | null)[] =>
        [...element.querySelectorAll('img')].map((image) => image.getAttribute('src'));

    it('says "12 recipes" beside the visibility, and names the link "{name}, {count}, {visibility}"', () => {
        renderList({ collections: [withCard(12, [])] });
        const link = screen.getByRole('link', { name: 'Weeknight Dinners, 12 recipes, Private' });

        expect(within(link).getByText('12 recipes')).toBeTruthy();
        expect(within(link).getByText('Private')).toBeTruthy();
    });

    it('says "1 recipe" for one', () => {
        renderList({ collections: [withCard(1, [])] });

        expect(screen.getByText('1 recipe')).toBeTruthy();
    });

    it('says no count when the read carried none, rather than a made-up 0', () => {
        renderList({ collections: [withCard(undefined, undefined)] });

        expect(screen.queryByText(/recipe$/u)).toBeNull();
        expect(screen.getByRole('link', { name: 'Weeknight Dinners, Private' })).toBeTruthy();
    });

    it('lays four photos out as a 2 × 2 album', () => {
        renderList({ collections: [withCard(9, [photo(1), photo(2), photo(3), photo(4)])] });
        const link = screen.getByRole('link');

        expect(photosIn(link)).toEqual([photo(1), photo(2), photo(3), photo(4)]);
    });

    it.each([1, 2, 3])('fills the box with the first photo when there are %s', (count) => {
        renderList({
            collections: [
                withCard(
                    count,
                    Array.from({ length: count }, (_unused, i) => photo(i + 1)),
                ),
            ],
        });

        expect(photosIn(screen.getByRole('link'))).toEqual([photo(1)]);
    });

    it('draws the tinted monogram when no member has a photo', () => {
        renderList({ collections: [withCard(3, [])] });

        expect(photosIn(screen.getByRole('link'))).toEqual([]);
    });
});

// Blank slot while scrolling (qa-ios, on the Recipes grid; the same cell pattern is here): a cell that grows vertically fills the
// recycler's ESTIMATE and is measured at it, so the row never shrinks to its card and leaves empty canvas between rows. Only a device
// lays the recycler out; what jsdom can pin is that the cell takes its card's height.
describe('CollectionListResults (native) — a grid cell takes its card’s height, never the recycler’s estimate', () => {
    it('the cell around a collection card does not grow vertically', () => {
        dims.width = 390;
        dims.fontScale = 1;
        renderList({ collections: threeCollections });
        let cell: HTMLElement | undefined;

        for (
            let node = screen.getByRole('link', { name: 'Weeknight Dinners, Private' }).parentElement;
            node !== null && cell === undefined;
            node = node.parentElement
        ) {
            if (getComputedStyle(node).paddingLeft === '8px') {
                cell = node;
            }
        }

        expect(cell).toBeDefined();
        expect(getComputedStyle(cell as HTMLElement).flexGrow).not.toBe('1');
    });
});

// Designer rule (2026-11-02, `designAnswers.md`, widened to every phone grid): two columns only while the container width over the
// CAPPED text scale is at least 320 pt, one column below. The list stub is display-inert for `numColumns`, so what shows is the
// cell: a grid cell carries the gap's side padding, a single column does not.
describe('CollectionListResults (native) — the grid’s columns follow the capped text scale', () => {
    const cellPad = (): string[] => {
        const out: string[] = [];

        for (
            let node = screen.getByRole('link', { name: 'Weeknight Dinners, Private' }).parentElement;
            node !== null;
            node = node.parentElement
        ) {
            out.push(getComputedStyle(node).paddingLeft);
        }

        return out;
    };

    it('is two columns at 1x on a 390 pt phone', () => {
        dims.width = 390;
        dims.fontScale = 1;
        renderList({ collections: threeCollections });

        expect(cellPad()).toContain('8px');
    });

    it('is one column at 2x on the same phone', () => {
        dims.width = 390;
        dims.fontScale = 2;
        renderList({ collections: threeCollections });

        expect(cellPad()).not.toContain('8px');
    });

    it('reads the CAPPED scale: a 3.1x system scale is the 2x cap, no further', () => {
        dims.width = 590;
        dims.fontScale = 3.1;
        renderList({ collections: threeCollections });

        // 590 is a narrow container (under 600 before the gutter); 590 / 2 = 295 is under 320, so one column even at the cap.
        expect(cellPad()).not.toContain('8px');
    });
});

// qa-ios (r4, Recipes): a layout that changes in place leaves FlashList one stale slot. Collections keys its list on the column
// count, so the 320 pt rule moving it (the text scale changed) gives a new list with a fresh size cache. Pinned here so the key
// is not dropped.
describe('CollectionListResults (native) — a new column count is a new list', () => {
    const scrollerOf = (): HTMLElement | null => {
        for (
            let node = screen.getByRole('link', { name: 'Weeknight Dinners, Private' }).parentElement;
            node !== null;
            node = node.parentElement
        ) {
            if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
                return node;
            }
        }

        return null;
    };

    const ui = (searchValue = '') => (
        <LocaleProvider locale="en">
            <CollectionListResults
                collections={threeCollections}
                total={3}
                onSelect={noop}
                search={{ value: searchValue, onChange: noop }}
                firstRun={{ hasRecipes: true, onAddRecipe: noop }}
            />
        </LocaleProvider>
    );

    it('mounts a new list when the text scale moves the grid from 2 columns to 1', () => {
        dims.width = 390;
        dims.fontScale = 1;
        const { rerender } = render(ui());
        const twoUp = scrollerOf();

        dims.fontScale = 2;
        rerender(ui());

        expect(twoUp).not.toBeNull();
        expect(scrollerOf()).not.toBe(twoUp);
    });

    it('keeps the same list for a re-render that changes nothing about the layout', () => {
        dims.width = 390;
        dims.fontScale = 1;
        const { rerender } = render(ui());
        const before = scrollerOf();

        rerender(ui('x'));

        expect(scrollerOf()).toBe(before);
    });
});
