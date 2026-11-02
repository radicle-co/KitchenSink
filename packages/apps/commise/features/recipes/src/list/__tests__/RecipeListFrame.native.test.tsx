/**
 * Native component tests for the recipe-list FRAME (react-native-web under jsdom) — the chrome that renders outside
 * the list's suspense boundary. Mirrors `RecipeListFrame.test.tsx`.
 *
 * Moved from the retired `RecipeList.native.test.tsx` ("chrome", "U8 brand title band", "source tabs (L5)", the search
 * placeholder's contrast, and the notice's screen-reader hand-off — which now arrives as `headingFocusSignal`).
 *
 * ⚠️ REWRITTEN in part for slice 4 of the UI overhaul: the source tabs become the My recipes · Collections segments, the
 * hand-built input becomes the design-system `SearchField` (which owns its placeholder contrast, so that test moved
 * there), and the field hides on the first run. The compact-height and focus invariants are kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sideInsetOf } from '@commise/test-utils';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { useContext } from 'react';
import { act, cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';

import { RecipeListFrame } from '../RecipeListFrame.native.js';
import { RecipeListHeaderContext } from '../recipeListHeaderContext.js';
import type { RecipeListFrameProps } from '../model.js';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // jsdom has no layout, so react-native-web reports a 0 dp window; the frame's segments read it (W-25).
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: 840, height: layout.windowHeight }),
    };
});

/**
 * The window's height class and the keyboard, served by the test: jsdom has neither a window to turn nor a keyboard.
 * The rules behind them are `@commise/ui/layout`'s own (`compactHeight.test.ts`, `useCompactHeight.native.test.tsx`).
 */
const layout = vi.hoisted(() => ({ compact: false, collapsed: false, windowHeight: 800 }));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useCompactHeight: () => layout.compact,
    useFrameCollapsed: () => layout.collapsed,
}));

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    layout.compact = false;
    layout.collapsed = false;
    layout.windowHeight = 800;
});

const noop = () => undefined;

/** The source switcher's destinations. Native ignores them (its shell has no URLs) — see the control's JSDoc. */
const HREF = { mine: '/en/recipes', collections: '/en/collections' } as const;

/**
 * The frame draws no header of its own: it hands it to the one list below it (`RecipeListHeaderContext`), which draws it
 * as its first child. This stands in for that list, so every test here still sees the header the frame builds.
 */
function HeaderOutlet() {
    return <>{useContext(RecipeListHeaderContext)}</>;
}

/** The one real text input: with the stand-in also named for the search, the label alone no longer picks one node. */
function searchInput(): HTMLInputElement {
    return screen.getByLabelText('Search your recipes', { selector: 'input' });
}

/** The header's spacer, which is the field's screen-reader stand-in while the field is idle. */
function spacerProxy(): HTMLElement {
    // The slide tests draw the outlet twice (once in the frame, once in their children), so the first one is the header's.
    const [first] = screen.getAllByRole('search', { name: 'Search your recipes' });

    return first as HTMLElement;
}

function frame(overrides: Partial<RecipeListFrameProps> = {}) {
    return (
        <RecipeListFrame
            searchValue=""
            onSearchChange={noop}
            searchVisible
            onCreateRecipe={noop}
            createEntryYields={false}
            headingFocusSignal={0}
            {...overrides}
        >
            <HeaderOutlet />
            {overrides.children ?? <Text>boundary content</Text>}
        </RecipeListFrame>
    );
}

describe('RecipeListFrame (native) — the floating create button (§3.4)', () => {
    // MOVED here from the settled results and the load error: it used to sit INSIDE the read boundary, so a pending or
    // offline read took it away. The frame is outside the boundary, so it shows offline and on a load error.
    it('floats "New recipe", opening the editor in one press', () => {
        const onCreateRecipe = vi.fn();
        render(frame({ onCreateRecipe }));

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('is absent while the screen yields it (first load in flight, or the first run)', () => {
        render(frame({ createEntryYields: true }));

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('is drawn in compact height too: hiding it with the keyboard is CreateFab`s own rule', () => {
        layout.compact = true;
        render(frame());

        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });
});

describe('RecipeListFrame (native) — chrome', () => {
    it('renders the heading, the search field and whatever the boundary below it renders', () => {
        render(frame());

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(searchInput()).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        render(frame({ onSearchChange }));

        fireEvent.change(searchInput(), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeListFrame (native) — the heading sits on the canvas', () => {
    // React Native renders a CSS font stack as the system font, silently. `getComputedStyle` does not resolve
    // react-native-web's class-compiled family, so this reads the injected declaration and rejects any stack.
    // REWRITTEN: the large title is the registered 600 face since 60cf38d84 (owner rule C1, the redesign's weight cap),
    // so this reads the face from the role rather than naming a weight.
    it('paints the heading in the large title role’s registered Manrope face, never a CSS font stack', () => {
        render(frame());

        const applied = appliedFontFamily(screen.getByRole('heading', { name: 'Recipes' }));

        expect(applied).toBe(nativeTokens.type.largeTitle.narrow.fontFamily);
        expect(applied).not.toContain(',');
    });

    it('in compact height the plain heading takes the large title role too: its 600 face, never the 700 bold', () => {
        layout.compact = true;
        render(frame());

        const heading = screen.getByRole('heading', { name: 'Recipes' });

        expect(appliedFontFamily(heading)).toBe(nativeTokens.type.largeTitle.narrow.fontFamily);
        // REWRITTEN: the bold step is now the 600 face too (the weight ceiling), so the old `not.toBe(bold)` could no
        // longer fail. What is held is that no 700 face is ever named.
        expect(appliedFontFamily(heading)).not.toMatch(/700/u);
    });

    it('does not wrap the heading in a gradient title band', () => {
        render(frame());
        // "No box in a box" (`docs/design/uiOverhaul/buildSpec.md` §1.6): a card exists only to group, and the page
        // canvas already carries the beach-glow wash, so the heading sits on the canvas, not in a second gradient.
        expect(
            screen.getByRole('heading', { name: 'Recipes' }).closest('[data-commise-stub="linear-gradient"]'),
        ).toBeNull();
    });
});

describe('RecipeListFrame (native) — segments and the first run', () => {
    it('renders no segments without a segments control', () => {
        render(frame());

        expect(screen.queryByRole('tab', { name: 'Collections' })).toBeNull();
    });

    it('renders My recipes · Collections as tabs, the current one selected, and reports a press', () => {
        const onSelect = vi.fn();
        render(frame({ segments: { current: 'mine', href: HREF, onSelect } }));

        expect(screen.getByRole('tab', { name: 'My recipes' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));

        expect(onSelect).toHaveBeenCalledWith('collections');
    });

    it('takes the segments’ own width on a tablet, where a full-width bar reads as a header and not a switch (W-25)', () => {
        render(frame({ segments: { current: 'mine', href: HREF, onSelect: vi.fn() } }));

        // The window is served at 840 dp, past the 600 dp threshold.
        expect(getComputedStyle(screen.getByRole('tablist', { name: 'Recipes' })).alignSelf).toBe('flex-start');
    });

    it('hides the search field on the first run, keeping the boundary', () => {
        render(frame({ searchVisible: false }));

        expect(screen.queryByLabelText('Search your recipes')).toBeNull();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });
});

describe('RecipeListFrame (native) — the heading takes the screen-reader cursor when a refresh recovers', () => {
    it('⛔ sends focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(frame());

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(frame({ headingFocusSignal: 1 }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Recipes' }),
            'focus',
        );
    });
});

/**
 * Read back the `font-family` react-native-web ACTUALLY applied to `element`: RNW compiles a `StyleSheet` family into
 * an atomic `r-fontFamily-*` class whose rule jsdom's `getComputedStyle` does not resolve, so the honest read is the
 * injected declaration itself. `undefined` when the element carries no compiled family.
 */
function appliedFontFamily(element: HTMLElement): string | undefined {
    // A style object that is not from `StyleSheet.create` (the large title picks one per container class) reaches the
    // DOM inline rather than as a compiled class, so the inline declaration is read first.
    const inline = element.style.getPropertyValue('font-family');

    if (inline !== '') {
        return inline;
    }

    const className = element.className.split(' ').find((name) => name.startsWith('r-fontFamily-'));

    if (className === undefined) {
        return undefined;
    }

    const sheets = document.styleSheets;

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        const rules = sheets[sheetIndex]?.cssRules;

        for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
            const rule = rules?.[ruleIndex];

            if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                return rule.style.getPropertyValue('font-family');
            }
        }
    }

    return undefined;
}

/**
 * `docs/design/compactHeightLayout.md` §5: on a phone held sideways the stacked header (title band, then the field)
 * took about 205 of 369 dp before one recipe. In compact height the heading shares a row with the field and the band
 * goes; the field NEVER changes parent or index, so a cook typing in it keeps focus and the keyboard while the layout
 * changes around them.
 */
describe('RecipeListFrame (native) — compact height', () => {
    it('drops the title band and puts the heading in one row with the search field', () => {
        layout.compact = true;
        const { container } = render(frame());

        expect(container.querySelector('[data-commise-stub="linear-gradient"]')).toBeNull();

        const heading = screen.getByRole('heading', { name: 'Recipes' });
        const group = heading.parentElement as HTMLElement;

        // REWRITTEN for C-2: the field itself is drawn once above the list; the header holds a spacer of its size, and that
        // spacer is what shares the row with the heading.
        expect(group.contains(spacerProxy())).toBe(true);
        expect(resolvedStyle(group, 'flexDirection')).toBe('row');
        // REWRITTEN: this pinned the compact heading's 700 bold face, the defect itself. Its face is now the large title
        // role's, asserted in "the heading sits on the canvas" above.
    });

    it('keeps the same field node, focused, through regular, compact and collapsed', () => {
        const { rerender } = render(frame());
        const field = searchInput() as HTMLInputElement;

        field.focus();

        for (const next of [
            { compact: true, collapsed: false },
            { compact: true, collapsed: true },
            { compact: false, collapsed: false },
        ]) {
            layout.compact = next.compact;
            layout.collapsed = next.collapsed;
            rerender(frame({ searchValue: `${String(next.compact)}${String(next.collapsed)}` }));

            expect(searchInput()).toBe(field);
            expect(document.activeElement).toBe(field);
        }
    });
});

describe('RecipeListFrame (native) — one side inset (bug sweep, LargeTitleHeader)', () => {
    // REWRITTEN for C-2: the header is the list's first child and the list is full width, so the frame no longer pads the
    // content by 16. The title insets itself once; each row of the list carries its own 16 (`RecipeListResults.native.test`).
    it('insets the title once (its own 16) and adds no side padding of its own under it', () => {
        render(frame());

        expect(sideInsetOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(16);
        expect(sideInsetOf(screen.getByText('boundary content'))).toBe(0);
    });

    it('pads the compact heading row by 16 too, where the large title is not drawn', () => {
        layout.compact = true;
        render(frame());

        // The group insets its own sides with the `$4` token, which the test lane resolves through `resolvedStyle`.
        const group = screen.getByRole('heading', { name: 'Recipes' }).parentElement as HTMLElement;

        expect(resolvedStyle(group, 'paddingLeft')).toBe('16px');
        expect(resolvedStyle(group, 'paddingRight')).toBe('16px');
    });
});

/** A node that took a layout handler: react-native-web keeps it on the node as `__reactLayoutHandler`. */
type LaidOut = HTMLElement & { __reactLayoutHandler?: (event: unknown) => void };

function isLaidOut(node: HTMLElement): node is LaidOut {
    return '__reactLayoutHandler' in node;
}

// Designer ruling (searchPinRuling.md): the search field is drawn ONCE, by the frame, above the list, and slides over a
// spacer of its size that the list's header holds. These pin the structure the slide depends on.
describe('RecipeListFrame (native) — the one search field and its spacer', () => {
    /** Every ancestor that took a layout handler (react-native-web keeps it on the node as `__reactLayoutHandler`). */
    function layoutNodesAround(element: HTMLElement): LaidOut[] {
        const nodes: LaidOut[] = [];

        for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
            if (isLaidOut(node)) {
                nodes.push(node);
            }
        }

        return nodes;
    }

    it('draws exactly one search field, whatever the list holds', () => {
        render(frame({ children: <Text>pending, failed or settled body</Text> }));

        expect(document.querySelectorAll('input')).toHaveLength(1);
    });

    it('draws none on the first run, where the host hides it', () => {
        render(frame({ searchVisible: false }));

        expect(screen.queryByLabelText('Search your recipes')).toBeNull();
    });

    it('leaves the header a spacer as tall as the field, once the field has been measured', () => {
        render(frame());
        const laid = layoutNodesAround(searchInput());

        // The field's own box reports its height; every layout-aware ancestor is told, and only the frame's wrapper acts.
        act(() => {
            laid.forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 0, width: 358, height: 48 } } }),
            );
        });

        const spacer = spacerProxy();

        expect(resolvedStyle(spacer, 'height')).toBe('48px');
    });

    it('keeps the same field node when the spacer is laid out again (a text size or width change)', () => {
        render(frame());
        const field = searchInput();
        const spacer: LaidOut = spacerProxy();

        act(() => spacer.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 120, width: 358, height: 0 } } }));
        act(() => spacer.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 260, width: 300, height: 0 } } }));

        expect(searchInput()).toBe(field);
    });
});

// The slide-and-stop, end to end through the real ScrollHost: the host owns one `scrollY` and the frame interpolates it,
// so the field rides with the page, holds at the top, and follows an overscroll. The numbers come from the layout the
// test reports: the field is 48 tall, the spacer sits 180 down the list's content (8 above it is the header's padding).
describe('RecipeListFrame (native) — the field slides with the scroll and stops at the top', () => {
    function ScrollProbe({ onHost }: { readonly onHost: (scrollY: Animated.Value) => void }) {
        const scrollY = useScrollHost().scrollY;

        if (scrollY !== undefined) {
            onHost(scrollY);
        }

        return null;
    }

    function renderOnHost() {
        const seen: { scrollY?: Animated.Value } = {};
        render(
            <ScrollHost>
                {() =>
                    frame({
                        children: (
                            <>
                                <HeaderOutlet />
                                <ScrollProbe onHost={(scrollY) => (seen.scrollY = scrollY)} />
                            </>
                        ),
                    })
                }
            </ScrollHost>,
        );
        const field = searchInput();

        const laid = (element: HTMLElement | null): LaidOut[] => {
            const nodes: LaidOut[] = [];

            for (let node = element; node !== null; node = node.parentElement) {
                if (isLaidOut(node)) {
                    nodes.push(node);
                }
            }

            return nodes;
        };

        act(() => {
            laid(field).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 0, width: 358, height: 48 } } }),
            );
            laid(spacerProxy()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 172, width: 358, height: 48 } } }),
            );
        });

        // The frame's animated box around the field: the one that carries the slide.
        const wrapper = field.closest('[style*="transform"]') as HTMLElement;

        return { scrollY: seen.scrollY as Animated.Value, wrapper };
    }

    const translateOf = (wrapper: HTMLElement): number =>
        Number(/translateY\((-?[\d.]+)px\)/u.exec(wrapper.style.transform)?.[1] ?? Number.NaN);

    it('starts at the field’s natural place in the content: the header’s 8 plus the spacer’s 172', () => {
        const { wrapper } = renderOnHost();

        expect(translateOf(wrapper)).toBe(180);
    });

    it('rises one for one with the scroll', () => {
        const { scrollY, wrapper } = renderOnHost();

        act(() => scrollY.setValue(50));

        expect(translateOf(wrapper)).toBe(130);
    });

    it('holds at the pinned top (8) once it gets there, however far the page scrolls', () => {
        const { scrollY, wrapper } = renderOnHost();

        act(() => scrollY.setValue(172));
        expect(translateOf(wrapper)).toBe(8);

        act(() => scrollY.setValue(900));
        expect(translateOf(wrapper)).toBe(8);
    });

    it('leaves the page with the rest, never pinning, when the field is over a third of a short window', () => {
        layout.windowHeight = 120;
        const { scrollY, wrapper } = renderOnHost();

        act(() => scrollY.setValue(900));

        expect(translateOf(wrapper)).toBeCloseTo(180 - 900, 5);
    });

    it('follows an overscroll or a pull to refresh down, instead of stopping at its natural place', () => {
        const { scrollY, wrapper } = renderOnHost();

        act(() => scrollY.setValue(-40));

        expect(translateOf(wrapper)).toBe(220);
    });
});

// Android crash, "Maximum update depth exceeded" on every launch of the Recipes tab (qa-device, 2026-11-02). The frame sets
// state from two layout reports, and a layout feedback loop needs only one report that re-renders without changing
// anything: React bails out of a state update only when the new value is the SAME value, and a fresh `{ x, y, width }` object
// per report never is. These pin that a report which says nothing new costs nothing, however often the platform repeats it.
describe('RecipeListFrame (native) — a layout report that changes nothing does not re-render', () => {
    const onRender = vi.fn();

    beforeEach(() => {
        onRender.mockClear();
    });

    function CountingOutlet() {
        onRender();

        return <>{useContext(RecipeListHeaderContext)}</>;
    }

    function laidOutBy(element: HTMLElement): LaidOut[] {
        const nodes: LaidOut[] = [];

        for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
            if (isLaidOut(node)) {
                nodes.push(node);
            }
        }

        return nodes;
    }

    it('re-renders nothing when the spacer reports the same box again, and when the field reports the same height', () => {
        render(
            <RecipeListFrame
                searchValue=""
                onSearchChange={noop}
                searchVisible
                onCreateRecipe={noop}
                createEntryYields={false}
                headingFocusSignal={0}
            >
                <CountingOutlet />
            </RecipeListFrame>,
        );

        const report = (element: HTMLElement | null, layout: Record<string, number>): void => {
            act(() => {
                laidOutBy(element as HTMLElement).forEach((node) =>
                    node.__reactLayoutHandler?.({ nativeEvent: { layout } }),
                );
            });
        };

        const spacer = spacerProxy();
        const field = searchInput();

        report(field, { x: 16, y: 0, width: 358, height: 48 });
        report(spacer, { x: 16, y: 172, width: 358, height: 48 });
        const settled = onRender.mock.calls.length;

        for (let again = 0; again < 20; again += 1) {
            report(field, { x: 16, y: 0, width: 358, height: 48 });
            report(spacer, { x: 16, y: 172, width: 358, height: 48 });
        }

        expect(onRender.mock.calls.length).toBe(settled);
    });

    it('treats a sub-pixel wobble in a report as the same layout: nothing re-renders for it', () => {
        render(
            <RecipeListFrame
                searchValue=""
                onSearchChange={noop}
                searchVisible
                onCreateRecipe={noop}
                createEntryYields={false}
                headingFocusSignal={0}
            >
                <CountingOutlet />
            </RecipeListFrame>,
        );
        const spacer = spacerProxy();

        act(() => {
            laidOutBy(spacer).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 172, width: 358, height: 48 } } }),
            );
        });
        const settled = onRender.mock.calls.length;

        for (const wobble of [0.0004, -0.0003, 0.0002, -0.0004]) {
            act(() => {
                laidOutBy(spacer).forEach((node) =>
                    node.__reactLayoutHandler?.({
                        nativeEvent: { layout: { x: 16 + wobble, y: 172 + wobble, width: 358 + wobble, height: 48 } },
                    }),
                );
            });
        }

        expect(onRender.mock.calls.length).toBe(settled);
    });
});

// qa-ios (ScaleToCap): swapping an `interpolate()` node on a native-driven view left the view showing the OLD node's value (the
// field at its 1x rest spot after the text went to the cap), 5 tries in 6 with the JS log identical in the pass. So the slide and
// the band are built ONCE over the host's offset and never swapped: a re-render, a new spacer y and a new field height create no
// Animated node at all, they only write the two inputs.
describe('RecipeListFrame (native) — the pin builds no Animated node after it mounts', () => {
    const spied = () => [
        vi.spyOn(Animated.Value.prototype, 'interpolate'),
        vi.spyOn(Animated, 'add'),
        vi.spyOn(Animated, 'subtract'),
        vi.spyOn(Animated, 'multiply'),
    ];

    it('creates no node for a re-render, a new spacer position or a new field height', () => {
        const { rerender } = render(<ScrollHost>{() => frame({ searchValue: '' })}</ScrollHost>);
        const spies = spied();

        const laid = (element: HTMLElement | null): LaidOut[] => {
            const nodes: LaidOut[] = [];

            for (let node = element; node !== null; node = node.parentElement) {
                if (isLaidOut(node)) {
                    nodes.push(node);
                }
            }

            return nodes;
        };

        rerender(<ScrollHost>{() => frame({ createEntryYields: true })}</ScrollHost>);
        act(() => {
            laid(spacerProxy()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 361, width: 358, height: 72 } } }),
            );
            laid(searchInput()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 0, width: 358, height: 72 } } }),
            );
        });

        expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
        spies.forEach((spy) => spy.mockRestore());
    });
});

/**
 * The reading order a screen reader gets (finding C-2, accessibility half). The drawn field sits in an overlay AFTER the
 * list, so a swipe reaches it behind every card. The spacer the header holds is therefore the field's ACCESSIBLE stand-in:
 * exposed while the field is idle, in the header's own place (after the segments, before whatever the list draws next),
 * and it hands the cook to the real field on a press. The two are never exposed together.
 *
 * jsdom reads the accessibility tree, not the order VoiceOver or TalkBack swipes in; that stays a physical-device check.
 */
describe('RecipeListFrame (native) — the search field in the screen-reader reading order', () => {
    const NAME = 'Search your recipes';

    /** What a screen reader can reach under this name: the buttons and the text boxes, hidden subtrees excluded. */
    function reachable() {
        return [
            ...screen.queryAllByRole('search', { name: NAME }),
            ...screen.queryAllByRole('textbox', { name: NAME }),
        ];
    }

    function theInput(): HTMLInputElement {
        return screen.getByLabelText(NAME, { selector: 'input' });
    }

    it('idle: exactly one reachable element named for the search, and it is the proxy, not the text box', () => {
        render(frame());

        expect(reachable()).toHaveLength(1);
        expect(screen.getAllByRole('search', { name: NAME })).toHaveLength(1);
        expect(screen.queryAllByRole('textbox', { name: NAME })).toHaveLength(0);
    });

    it('idle: the proxy comes after the segments in the tree, where the field sits on screen', () => {
        render(frame({ segments: { current: 'mine', href: HREF, onSelect: vi.fn() } }));

        const segment = screen.getByRole('tab', { name: 'Collections' });
        const proxy = screen.getByRole('search', { name: NAME });

        expect(segment.compareDocumentPosition(proxy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('idle: the proxy comes before whatever the list draws after the header', () => {
        render(frame({ children: <Text>a recipe card</Text> }));

        const proxy = screen.getByRole('search', { name: NAME });

        expect(
            proxy.compareDocumentPosition(screen.getByText('a recipe card')) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('pressing the proxy gives the real field keyboard focus', () => {
        render(frame());

        fireEvent.click(screen.getByRole('search', { name: NAME }));

        expect(document.activeElement).toBe(theInput());
    });

    it('focused: the proxy steps aside and the field is the one reachable element', () => {
        render(frame());

        act(() => {
            theInput().focus();
        });

        expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
        expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
        expect(reachable()).toHaveLength(1);
    });

    it('leaving an empty field returns the stand-in, so the order is whole again', () => {
        render(frame());

        act(() => {
            theInput().focus();
        });
        act(() => {
            theInput().blur();
        });

        expect(screen.getAllByRole('search', { name: NAME })).toHaveLength(1);
        expect(screen.queryAllByRole('textbox', { name: NAME })).toHaveLength(0);
    });

    it('a field holding a query stays the reachable one when it is not focused: its clear control must stay reachable', () => {
        render(frame({ searchValue: 'lamb' }));

        expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
        expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    });

    // The drawn field slides with the page and pins at the top, so a cook who has scrolled sees it where the stand-in has
    // left. Hidden from accessibility there, it would be unreachable: a screen reader must reach what is on screen.
    it('scrolled down: the field the cook sees pinned is the reachable one, and the stand-in steps aside', () => {
        let bind: ScrollBind | undefined;
        render(
            <ScrollHost>
                {(host) => {
                    bind = host;

                    return frame();
                }}
            </ScrollHost>,
        );

        expect(screen.getAllByRole('search', { name: NAME })).toHaveLength(1);

        act(() => {
            bind?.onScroll({
                nativeEvent: {
                    contentOffset: { y: 400 },
                    layoutMeasurement: { height: 800 },
                    contentSize: { height: 4000 },
                },
            });
        });

        expect(screen.queryAllByRole('search', { name: NAME })).toHaveLength(0);
        expect(screen.getAllByRole('textbox', { name: NAME })).toHaveLength(1);
    });

    it('draws no stand-in when the host hides the search (the first run)', () => {
        render(frame({ searchVisible: false }));

        expect(reachable()).toHaveLength(0);
    });
});

// Designer fix (2026-11-02): while the field is pinned it floats on the cards, so card text and edges show above and
// beside it. A band in the canvas colour sits behind it, from the top of the list's frame to 8 below the field, with a
// lineDivider hairline on its bottom edge. It is part of the field's own overlay, so it rides the same native translateY,
// it shows only once the field is pinned (that is when content is under it), and it takes no touches.
function BandScrollProbe({ onHost }: { readonly onHost: (scrollY: Animated.Value) => void }) {
    const scrollY = useScrollHost().scrollY;

    if (scrollY !== undefined) {
        onHost(scrollY);
    }

    return null;
}

describe('RecipeListFrame (native) — the band behind the pinned field', () => {
    function renderPinnable(scheme: 'light' | 'dark' = 'light') {
        const seen: { scrollY?: Animated.Value } = {};
        renderWithTamagui(
            <ScrollHost>
                {() =>
                    frame({
                        children: (
                            <>
                                <HeaderOutlet />
                                <BandScrollProbe onHost={(scrollY) => (seen.scrollY = scrollY)} />
                            </>
                        ),
                    })
                }
            </ScrollHost>,
            scheme,
        );

        const laid = (element: HTMLElement | null): LaidOut[] => {
            const nodes: LaidOut[] = [];

            for (let node = element; node !== null; node = node.parentElement) {
                if (isLaidOut(node)) {
                    nodes.push(node);
                }
            }

            return nodes;
        };

        act(() => {
            laid(searchInput()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 0, width: 358, height: 48 } } }),
            );
            laid(spacerProxy()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 172, width: 358, height: 48 } } }),
            );
        });

        return { scrollY: seen.scrollY as Animated.Value, band: screen.getByTestId('searchBand') };
    }

    it.each(['light', 'dark'] as const)('is painted in the canvas colour (%s)', (scheme) => {
        const { band } = renderPinnable(scheme);

        expect(resolvedColour(band, 'backgroundColor')).toBe(rgb(rolesFor(scheme).canvas));
    });

    it('spans the full width from the top of the frame to 8 below the field', () => {
        const { band } = renderPinnable();
        const box = band.parentElement as HTMLElement;

        // The frame's top is 8 above the pinned field (its pinned top), the field is 48 tall, and 8 more below it.
        expect(box.style.top).toBe('-8px');
        expect(box.style.height).toBe('64px');
        expect(box.style.width).toBe('840px');
        // The field's left is the spacer's 16, so the band steps back out by that to reach the screen's edge.
        expect(box.style.left).toBe('-16px');
    });

    it('rides the field’s own native translate, inside the same overlay box', () => {
        const { band } = renderPinnable();
        const wrapper = searchInput().closest('[style*="transform"]');

        expect(band.closest('[style*="transform"]')).toBe(wrapper);
    });

    it('is hidden while the field slides, and shown (with its hairline) once the field is pinned', () => {
        const { scrollY, band } = renderPinnable();
        const opacityOf = (): number => Number((band.parentElement as HTMLElement).style.opacity);

        expect(opacityOf()).toBe(0);

        act(() => scrollY.setValue(100));
        expect(opacityOf()).toBe(0);

        act(() => scrollY.setValue(172));
        expect(opacityOf()).toBe(1);

        act(() => scrollY.setValue(900));
        expect(opacityOf()).toBe(1);
        expect(resolvedStyle(band, 'borderBottomWidth')).not.toBe('0px');
    });

    it('draws the hairline on the bottom edge only, and no shadow', () => {
        const { band } = renderPinnable();

        expect(resolvedStyle(band, 'borderTopWidth')).toBe('0px');
        expect(resolvedStyle(band, 'borderBottomWidth')).not.toBe('0px');
        expect(getComputedStyle(band).boxShadow).toBe('');
    });

    // The text size changes while the list is up: the field is re-measured taller and the header pushes the spacer further down.
    // The slot follows the new field height, and the slide and the band are rebuilt from the new spacer position.
    it('re-measures after a text-scale change: the spacer takes the new field height and the slide the new spacer y', () => {
        const { scrollY } = renderPinnable();

        const laid = (element: HTMLElement | null): LaidOut[] => {
            const nodes: LaidOut[] = [];

            for (let node = element; node !== null; node = node.parentElement) {
                if (isLaidOut(node)) {
                    nodes.push(node);
                }
            }

            return nodes;
        };

        const wrapper = searchInput().closest('[style*="transform"]') as HTMLElement;

        act(() => {
            laid(searchInput()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 0, width: 358, height: 72 } } }),
            );
            laid(spacerProxy()).forEach((node) =>
                node.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 16, y: 300, width: 358, height: 72 } } }),
            );
        });
        const pinsAt = 300;

        expect(resolvedStyle(spacerProxy(), 'height')).toBe('72px');
        expect(Number(/translateY\((-?[\d.]+)px\)/u.exec(wrapper.style.transform)?.[1])).toBe(308);

        act(() => scrollY.setValue(100));
        expect(Number(/translateY\((-?[\d.]+)px\)/u.exec(wrapper.style.transform)?.[1])).toBe(208);

        act(() => scrollY.setValue(pinsAt + 50));
        expect(Number(/translateY\((-?[\d.]+)px\)/u.exec(wrapper.style.transform)?.[1])).toBe(8);
        expect((wrapper.firstElementChild as HTMLElement).style.height).toBe('88px');
    });

    it('takes no touches, so the cards below its bottom edge (and under it) stay pressable', () => {
        const { band } = renderPinnable();

        expect(getComputedStyle(band.parentElement as HTMLElement).pointerEvents).toBe('none');
    });

    it('never shows for a field too big to pin: it leaves with the page', () => {
        layout.windowHeight = 120;
        const { scrollY, band } = renderPinnable();

        act(() => scrollY.setValue(900));

        expect(Number((band.parentElement as HTMLElement).style.opacity)).toBe(0);
    });
});

// qa-ios: `TypeError: Cannot read property 'layout' of null`, about one text-size switch in ten. The renderer releases the layout
// event when the handler returns, and a state updater runs LATER, in render. The handler must read the layout before it
// returns. This hands the spacer's handler an event that is released (its `nativeEvent` nulled) the moment the handler returns,
// as the renderer does, and renders what follows.
describe('RecipeListFrame (native) — the spacer reads its layout before the event is released', () => {
    // React computes the FIRST updater of a quiet fiber eagerly, inside the handler; a second report in the same batch (the
    // platform sends several while a header settles) is queued and runs in render, which is where the defect bites.
    it('survives layout events that are released when the handler returns', () => {
        render(frame());
        const handler = (spacerProxy() as LaidOut).__reactLayoutHandler;
        const eventAt = (y: number) => ({
            nativeEvent: { layout: { x: 16, y, width: 358, height: 48 } } as { layout: object } | null,
        });
        const events = [eventAt(300), eventAt(353)];

        expect(() =>
            act(() => {
                for (const event of events) {
                    handler?.(event);
                    // The renderer's release: the pooled event's nativeEvent is nulled once the handler has returned.
                    event.nativeEvent = null;
                }
            }),
        ).not.toThrow();
    });
});
