/**
 * Native component tests for the collection-list FRAME — the chrome outside the list's suspense boundary. Moved from
 * the retired `CollectionList.native.test.tsx` ("chrome", and the notice's focus move, now the `headingFocusSignal`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { useContext } from 'react';
import { act, cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { sideInsetOf } from '@commise/test-utils';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionListFrame } from '../CollectionListFrame.native.js';
import { RecipeListHeaderContext } from '../../list/recipeListHeaderContext.js';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // jsdom has no layout, so react-native-web reports a 0 dp window; the frame's segments read it (W-25).
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: 840, height: 800 }),
    };
});

afterEach(cleanup);

const noop = () => undefined;

/**
 * The frame draws no header of its own: it hands it to the one list below it (`RecipeListHeaderContext`), which draws it as
 * its first child. This stands in for that list, so every test here still sees the header the frame builds.
 */
function HeaderOutlet() {
    return <>{useContext(RecipeListHeaderContext)}</>;
}

describe('CollectionListFrame (native)', () => {
    it('renders the heading, the create action and whatever the boundary below it renders', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <HeaderOutlet />
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('hands the create button focus when asked, and reports once it has', () => {
        const handled = vi.fn();
        render(
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
                createFocusRequested
                onCreateFocusHandled={handled}
            >
                {null}
            </CollectionListFrame>,
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New collection' }));
        expect(handled).toHaveBeenCalledOnce();
    });

    it('reports create requests upward', () => {
        const onCreate = vi.fn();
        render(
            <CollectionListFrame onCreate={onCreate} headingFocusSignal={0}>
                <HeaderOutlet />
            </CollectionListFrame>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves the screen-reader cursor to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <HeaderOutlet />
            </CollectionListFrame>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(
            <CollectionListFrame onCreate={noop} headingFocusSignal={1}>
                <HeaderOutlet />
            </CollectionListFrame>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Recipes' }),
            'focus',
        );
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the frame's heading says its name, so the frame carries none and the
 * heading is the one node that says it (N4).
 */
describe('CollectionListFrame (native) — N1: the frame’s name is said once, by its heading', () => {
    // Slice 3 (buildSpec §5.1): Collections is a segment of the Recipes destination, so the H1 reads "Recipes".
    it('says "Recipes" through one header, and no node is labelled with it', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <HeaderOutlet />
            </CollectionListFrame>,
        );

        expect(screen.getAllByRole('heading', { name: 'Recipes' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Recipes')).toEqual([]);
    });
});

/**
 * Slice 3 replaced the slice 2 secondary header Button with the floating create button (buildSpec §5.1). The FAB's
 * own face is pinned by `@commise/ui`'s `CreateFab` suite; this pins that the frame offers ONE create control.
 */
describe('CollectionListFrame (native) — the floating create button (UI overhaul slice 3)', () => {
    it('offers exactly one "New collection" control, the floating button', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <HeaderOutlet />
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.getAllByRole('button', { name: 'New collection' })).toHaveLength(1);
    });

    it('takes the segments’ own width on a tablet, where a full-width bar reads as a header and not a switch (W-25)', () => {
        render(
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
                segments={{
                    current: 'collections',
                    href: { mine: '/en/recipes', collections: '/en/collections' },
                    onSelect: noop,
                }}
            >
                <HeaderOutlet />
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        // The window is served at 840 dp, past the 600 dp threshold.
        expect(getComputedStyle(screen.getByRole('tablist')).alignSelf).toBe('flex-start');
    });

    it('hides it while the screen yields it (first load, or the first run whose own start buttons take its place) (buildSpec §3.4)', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0} createEntryYields>
                <HeaderOutlet />
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.queryByRole('button', { name: 'New collection' })).toBeNull();
    });
});

describe('CollectionListFrame (native) — one side inset (bug sweep, LargeTitleHeader)', () => {
    // REWRITTEN: the header is the list's first child and the list is full width, so the frame no longer pads the content
    // by 16. The title insets itself once; each row of the list carries its own 16 (`CollectionListResults.native.test`).
    it('insets the title once (its own 16) and adds no side padding of its own under it', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <HeaderOutlet />
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(sideInsetOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(16);
        expect(sideInsetOf(screen.getByText('boundary content'))).toBe(0);
    });
});

// Designer ruling (2026-11-02): where the Collections tab has a search field ("Search your collections", from six collections) it
// follows the Recipes rule. The field is drawn ONCE by the frame, over a spacer the list's header holds, and slides with the scroll
// until it pins at the top on a canvas band; the title, segments and count scroll away. For a screen reader the spacer is the
// field's stand-in, and exactly one of the two is exposed at a time. These are the Recipes frame's own cases, for this frame; the
// pieces are shared (`searchPin`, the overlay, the band, `HostAnimatedScroll`), so a difference here is a bug in the sharing.
describe('CollectionListFrame (native) — the pinned search', () => {
    const NAME = 'Search your collections';

    function pinnedFrame(props: { readonly searchValue?: string; readonly searchVisible?: boolean } = {}) {
        return (
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
                search={{ value: props.searchValue ?? '', onChange: noop, visible: props.searchVisible ?? true }}
                segments={{
                    current: 'collections',
                    href: { mine: '/en/recipes', collections: '/en/collections' },
                    onSelect: noop,
                }}
            >
                <HeaderOutlet />
                <Text>a collection card</Text>
            </CollectionListFrame>
        );
    }

    const reachable = () => [
        ...screen.queryAllByRole('search', { name: NAME }),
        ...screen.queryAllByRole('textbox', { name: NAME }),
    ];
    const theInput = (): HTMLInputElement => screen.getByLabelText(NAME, { selector: 'input' });

    it('idle: exactly one reachable element named for the search, and it is the stand-in', () => {
        render(pinnedFrame());

        expect(reachable()).toHaveLength(1);
        expect(screen.getAllByRole('search', { name: NAME })).toHaveLength(1);
    });

    it('idle: the stand-in reads after the segments and before the cards', () => {
        render(pinnedFrame());
        const stand = screen.getByRole('search', { name: NAME });
        const follows = (earlier: HTMLElement, later: HTMLElement): boolean =>
            Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

        expect(follows(screen.getByRole('tab', { name: 'Collections' }), stand)).toBe(true);
        expect(follows(stand, screen.getByText('a collection card'))).toBe(true);
    });

    it('pressing the stand-in gives the real field keyboard focus', () => {
        render(pinnedFrame());

        fireEvent.click(screen.getByRole('search', { name: NAME }));

        expect(document.activeElement).toBe(theInput());
    });

    it('focused: the stand-in steps aside and the field is the one reachable element', () => {
        render(pinnedFrame());

        act(() => {
            theInput().focus();
        });

        expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
        expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
    });

    it('a field holding a query stays reachable when it is not focused, with its clear control', () => {
        render(pinnedFrame({ searchValue: 'dinner' }));

        expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
        expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    });

    it('draws no field and no stand-in when the host hides the search (fewer than six collections)', () => {
        render(pinnedFrame({ searchVisible: false }));

        expect(reachable()).toHaveLength(0);
        expect(screen.queryByLabelText(NAME)).toBeNull();
    });

    describe('on a scroll host', () => {
        function OffsetProbe({ onOffset }: { readonly onOffset: (scrollY: Animated.Value) => void }) {
            const { scrollY } = useScrollHost();

            if (scrollY !== undefined) {
                onOffset(scrollY);
            }

            return null;
        }

        function renderOnHost(scheme: 'light' | 'dark' = 'light') {
            const seen: { scrollY?: Animated.Value; bind?: ScrollBind } = {};
            renderWithTamagui(
                <ScrollHost>
                    {(bind) => {
                        seen.bind = bind;

                        return (
                            <>
                                {pinnedFrame()}
                                <OffsetProbe onOffset={(scrollY) => (seen.scrollY = scrollY)} />
                            </>
                        );
                    }}
                </ScrollHost>,
                scheme,
            );

            return { seen, band: screen.getByTestId('searchBand') };
        }

        it('paints the band in the canvas colour, in both schemes', () => {
            for (const scheme of ['light', 'dark'] as const) {
                const { band } = renderOnHost(scheme);

                expect(resolvedColour(band, 'backgroundColor')).toBe(rgb(rolesFor(scheme).canvas));
                cleanup();
            }
        });

        it('shows the band only once the field is pinned, and takes no touches', () => {
            const { seen, band } = renderOnHost();
            const box = band.parentElement as HTMLElement;

            expect(Number(box.style.opacity)).toBe(0);
            expect(getComputedStyle(box).pointerEvents).toBe('none');

            act(() => seen.scrollY?.setValue(900));

            expect(Number(box.style.opacity)).toBe(1);
        });

        it('swaps the exposed element when the page scrolls: the pinned field is the reachable one', () => {
            const { seen } = renderOnHost();

            act(() =>
                seen.bind?.onScroll({
                    nativeEvent: {
                        contentOffset: { y: 400 },
                        layoutMeasurement: { height: 800 },
                        contentSize: { height: 4000 },
                    },
                }),
            );

            expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
            expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
        });
    });
});
