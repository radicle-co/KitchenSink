/**
 * Sheet (native) — the footer unpins past a limit (`docs/design/ingredientSpecialization.md` §S8.1, finding I7; owner
 * ruling, option B). When the pinned title row and the footer together take more than half the sheet's height, the
 * footer (`Done`) scrolls with the content; Close stays pinned in the title row.
 *
 * The rule needs real heights, which the panel takes from `onLayout`. react-native-web implements `onLayout` with a
 * `ResizeObserver` and reads each node's `offsetHeight`, neither of which jsdom lays out, so this file installs a
 * recording `ResizeObserver` and serves the heights itself. That keeps the WIRING under test (which node reports which
 * height), not only the pure rule (`layout/__tests__/pinnedFooter.test.ts`).
 *
 * ⚠️ The on-device proof is the Maestro landscape flow, which types into the filter sheet with the keyboard up.
 */
import { reportResize } from '../../testing/resizeObserver.js';
import { act, cleanup, screen } from '@testing-library/react';
import { createElement, useEffect, type ComponentProps, type FC, type JSX } from 'react';
import { Text, TextInput, type ScrollView as ScrollViewType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogActions } from '../../dialogActions/DialogActions.native.js';
import { touchFloor } from '../../layout/touchFloor.native.js';
import { render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';

const state = vi.hoisted(() => ({ keyboardShown: false }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        // The real ScrollView, its element marked, so "the footer scrolls with the content" is "the footer sits
        // inside the scroll region".
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement('div', { 'data-scroll-region': true }, createElement(actual.ScrollView, props)),
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => state.keyboardShown }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));

beforeEach(() => {
    vi.useFakeTimers();
    state.keyboardShown = false;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function renderSheet(overrides: Partial<SheetProps> = {}): void {
    render(
        <Sheet
            open
            onOpenChange={vi.fn()}
            title="Filter recipes"
            closeLabel="Close filters"
            size="content"
            footer={<Text accessibilityRole="button">Done</Text>}
            {...overrides}
        >
            <Text>Dietary</Text>
        </Sheet>,
    );
}

/**
 * The value react-native-web applied for a CSS property: `StyleSheet.create` styles compile to atomic `r-*` classes
 * (walked back to their rules, since jsdom's `getComputedStyle` does not resolve them), and per-render styles land
 * inline.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    let resolved: string | undefined;

    for (const className of element.className.split(' ').filter((name) => name.startsWith('r-'))) {
        for (const sheet of Array.from(document.styleSheets)) {
            for (const rule of Array.from(sheet.cssRules)) {
                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    resolved = rule.style.getPropertyValue(property) || resolved;
                }
            }
        }
    }

    return resolved;
}

/**
 * A sheet with a toolbar and a footer, for the collapse cases. Called once per render: the keyboard double is a plain
 * read, so an identical element would let React skip the render that reads it.
 */
const toolbarSheet = (): JSX.Element => (
    <Sheet
        open
        onOpenChange={vi.fn()}
        title="Filter recipes"
        closeLabel="Close filters"
        size="content"
        toolbar={{ heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> }}
        footer={<Text accessibilityRole="button">Done</Text>}
    >
        <Text>Dietary</Text>
    </Sheet>
);

/** The sheet: the dialog nearest around its title header, which names it (`docs/design/nativeContainerNames.md` N1). */
const dialog = (): HTMLElement =>
    screen.getByRole('heading', { name: 'Filter recipes' }).closest('[role="dialog"]') as HTMLElement;
/**
 * The title row: the nearest ancestor of Close that also holds the title. It is found by what it holds, so it does not
 * depend on how many boxes the icon button nests its button in.
 */
const titleRow = (): HTMLElement => {
    const heading = screen.getByRole('heading', { name: 'Filter recipes' });

    for (
        let box = screen.getByRole('button', { name: 'Close filters' }).parentElement;
        box !== null;
        box = box.parentElement
    ) {
        if (box.contains(heading)) {
            return box;
        }
    }

    throw new Error('Expected an ancestor of Close to hold the title.');
};
/** The swipe zone: the grab handle and the title row. */
const swipeZone = (): HTMLElement => titleRow().parentElement as HTMLElement;
/**
 * The top block the footer decision measures: everything pinned above the scroll region, which is the swipe zone (the
 * grab handle and the title row with Close) and, below it, the toolbar. REWRITTEN for issue #192 review item 3: it used
 * to be the swipe zone alone (Close's grandparent), which left a toolbar out of the measure. Before that, parity item 7
 * added the handle to the zone.
 */
const topBlock = (): HTMLElement => swipeZone().parentElement as HTMLElement;
/** The footer: the view that holds Done. */
const footer = (): HTMLElement => screen.getByRole('button', { name: 'Done' }).parentElement as HTMLElement;
const scrollRegion = (): Element => dialog().querySelector('[data-scroll-region]') as Element;

/**
 * Report layout: give each node its height, fire the observer for every node it watches, and let react-native-web's
 * deferred measurement run.
 */
function layOut(heights: { readonly sheet: number; readonly topBlock: number; readonly footer: number }): void {
    for (const [node, height] of [
        [dialog(), heights.sheet],
        [topBlock(), heights.topBlock],
        [footer(), heights.footer],
    ] as const) {
        Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
    }

    reportLayout();
}

/** Fire the observer for every node it watches, then let react-native-web's deferred measurement run. */
function reportLayout(): void {
    act(() => {
        reportResize();
    });
    act(() => {
        vi.runOnlyPendingTimers();
    });
}

describe('Sheet (native) — the footer unpins past a limit', () => {
    it('is pinned before anything is measured', () => {
        renderSheet();

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('stays pinned while the title row and footer take half the sheet or less', () => {
        renderSheet();
        layOut({ sheet: 600, topBlock: 56, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('scrolls the footer with the content once they take more than half; Close stays pinned', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Close filters' }))).toBe(false);
        // The footer is the last thing in the region, after the content.
        const done = screen.getByRole('button', { name: 'Done' });

        expect(screen.getByText('Dietary').compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('does not flip back when the moved footer reports the same height from its new place', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });
        layOut({ sheet: 300, topBlock: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    it('pins it again when the sheet grows back: the keyboard closes, or the phone turns upright', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });
        layOut({ sheet: 700, topBlock: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('keeps the hairline above an unpinned footer, which now ends the list', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });

        expect(appliedStyle(footer(), 'border-top-width')).toMatch(/^0?\.?\d+(\.\d+)?px$/u);
        expect(appliedStyle(footer(), 'border-top-width')).not.toBe('0px');
    });

    // ⛔ The footer's last height is KEPT while the collapse unmounts it: reset to 0, it would come back pinned and only
    // unpin a frame later, a visible jump under the cook's thumb.
    it('keeps the footer’s measured height through a collapse, so it comes back where it was', () => {
        const { rerender } = render(toolbarSheet());

        layOut({ sheet: 300, topBlock: 64, footer: 92 });
        state.keyboardShown = true;
        act(() => rerender(toolbarSheet()));
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

        state.keyboardShown = false;
        act(() => rerender(toolbarSheet()));

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    // Issue #192. The keyboard shrinks the sheet a layout pass before this rule unpins the footer, so for one frame the
    // pinned title row and footer can take the whole sheet. A scroll region laid out at zero height there cost the field
    // being typed in its focus on an Android phone held sideways (measured: blur in that frame; with a floor, none).
    // jsdom lays nothing out, so this pins the frame's STYLE: a floor of one control, and the bare `ScrollView`'s grow
    // and shrink, so a `full` sheet's region still fills it and a `content` sheet's still fits. The layout itself is
    // proved on a device by the Maestro landscape flow.
    it('frames the scroll region with a one-control floor and the scroll view’s own grow and shrink', () => {
        renderSheet();

        // The frame the scroll region sits in: the element around the marked `ScrollView`.
        const frame = scrollRegion().parentElement;

        if (frame === null) {
            throw new Error('the scroll region has no frame around it');
        }

        expect(resolvedStyle(frame, 'minHeight')).toBe(`${touchFloor()}px`);
        expect(resolvedStyle(frame, 'flexGrow')).toBe('1');
        expect(resolvedStyle(frame, 'flexShrink')).toBe('1');
    });

    // Review item 3 on #204. The toolbar sits above the scroll region as the title row does, so the floor cannot take
    // its height. A measure that leaves it out keeps the footer pinned while title row + toolbar + footer leave the
    // region less than the floor, and the floor then pushes the footer past the sheet's clipped edge.
    it('counts the toolbar with the title row, so a tall toolbar unpins the footer', () => {
        renderSheet({ toolbar: { heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> } });

        expect(topBlock().contains(screen.getByText('Search'))).toBe(true);
        expect(topBlock().contains(scrollRegion())).toBe(false);

        // The swipe zone alone (handle and title row) is 56: with the 92 footer that is 148, under half of 300, so a
        // measure of the swipe zone alone would keep the footer pinned.
        Object.defineProperty(swipeZone(), 'offsetHeight', { value: 56, configurable: true });
        layOut({ sheet: 300, topBlock: 166, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    // While the toolbar is collapsed its heading sits in the title row and the block measures shorter. That height is
    // not kept: judged by it, the footer would come back pinned and unpin a frame later, under the cook's thumb.
    it('keeps the top block’s height from before a collapse', () => {
        const { rerender } = render(toolbarSheet());

        layOut({ sheet: 300, topBlock: 166, footer: 92 });
        state.keyboardShown = true;
        act(() => rerender(toolbarSheet()));

        // Collapsed and measured at 40: 40 + 92 is under half of 300, so a kept 40 would pin the footer again.
        Object.defineProperty(topBlock(), 'offsetHeight', { value: 40, configurable: true });
        reportLayout();
        state.keyboardShown = false;
        act(() => rerender(toolbarSheet()));

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    it('still hides an unpinned footer while the toolbar is collapsed', () => {
        state.keyboardShown = true;
        renderSheet({ toolbar: { heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> } });

        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
});

/**
 * A footer that holds `DialogActions` changes height with its form (stacked tall, row short), and the move between the
 * two parents remounts it (staff D3). `pinnedFooter.ts`'s no-flip-back argument needs a footer of one height across the
 * move, so without the width memento (staff D5) a remounted footer starts stacked again and the pin alternates.
 */
describe('Sheet (native) — a DialogActions footer across the I7 move', () => {
    const STACKED_FOOTER = 320;
    const ROW_FOOTER = 150;
    // Frame 800 and top 100: a row footer (250) pins, a stacked one (420) unpins, and a row box of 720 fits a row.
    const FRAME = 800;
    const TOP = 100;
    const ACTIONS_WIDTH = 720;

    const actionsRow = (): HTMLElement => screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;
    const isRow = (): boolean => getComputedStyle(actionsRow()).flexDirection === 'row';
    const inScroll = (): boolean => scrollRegion().contains(screen.getByRole('button', { name: 'Keep' }));

    /** One layout round: every node reports the height of the form it rendered. Returns the form it started in. */
    function round(): { readonly startedAsRow: boolean; readonly unpinned: boolean } {
        const startedAsRow = isRow();
        const footerView = actionsRow().parentElement as HTMLElement;

        for (const [node, size] of [
            [dialog(), FRAME],
            [topBlock(), TOP],
            [footerView, startedAsRow ? ROW_FOOTER : STACKED_FOOTER],
        ] as const) {
            Object.defineProperty(node, 'offsetHeight', { value: size, configurable: true });
        }

        Object.defineProperty(actionsRow(), 'offsetWidth', { value: ACTIONS_WIDTH, configurable: true });
        reportLayout();

        return { startedAsRow, unpinned: inScroll() };
    }

    const renderActionsSheet = (): void => {
        renderSheet({
            footer: (
                <DialogActions sideBySideFrom={400}>
                    <Text accessibilityRole="button">Keep</Text>
                    <Text accessibilityRole="button">Do it</Text>
                </DialogActions>
            ),
        });
    };

    it('settles: the footer moves once, then stays pinned and is a row on its first render after every move', () => {
        renderActionsSheet();

        const rounds = Array.from({ length: 6 }, () => round());

        // The first round's stacked footer (320) passes half the frame, so the footer DOES move into the scroll region;
        // the seeded row (150) then moves it back and it stays. A version where nothing ever moves fails the first line.
        expect(rounds[0]?.unpinned).toBe(true);
        expect(rounds.slice(2).every((entry) => !entry.unpinned && entry.startedAsRow)).toBe(true);
    });

    it('does not seed a DialogActions in the body from the footer’s memento', () => {
        const actions = (names: readonly [string, string], key: string): JSX.Element => (
            <DialogActions key={key} sideBySideFrom={400}>
                <Text accessibilityRole="button">{names[0]}</Text>
                <Text accessibilityRole="button">{names[1]}</Text>
            </DialogActions>
        );
        const sheet = (bodyKey: string): JSX.Element => (
            <Sheet
                open
                onOpenChange={vi.fn()}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
                footer={actions(['Keep', 'Do it'], 'footer')}
            >
                {actions(['Body keep', 'Body do it'], bodyKey)}
            </Sheet>
        );
        const { rerender } = render(sheet('first'));

        // The footer's actions measure 720 and the frame remembers it.
        Object.defineProperty(actionsRow(), 'offsetWidth', { value: ACTIONS_WIDTH, configurable: true });
        reportLayout();
        expect(isRow()).toBe(true);

        // A body instance that mounts now starts stacked: the memento wraps the footer only.
        act(() => {
            rerender(sheet('second'));
        });
        const bodyRow = screen.getByRole('button', { name: 'Body keep' }).parentElement as HTMLElement;

        expect(getComputedStyle(bodyRow).flexDirection).toBe('column-reverse');
    });
});

/** Counts how often the field MOUNTS, so a move that remounts it is seen (qse C-3: a counter, never a ref). */
const fieldMounts = { count: 0 };

const CountedField: FC = () => {
    useEffect(() => {
        fieldMounts.count += 1;
    }, []);

    return <TextInput accessibilityLabel="Quantity" />;
};

/**
 * AE16 (plan largeTextSheet): the footer moves into the scroll region while a body field has focus. The field is the same
 * instance and keeps focus, and the footer does not move back.
 */
describe('Sheet (native) — a focused body field while the footer moves (AE16)', () => {
    it('keeps the same field instance and its focus, and the footer does not move back', () => {
        fieldMounts.count = 0;
        renderSheet();
        // `renderSheet` ignores `children`, so this sheet renders its own body.
        cleanup();
        render(
            <Sheet
                open
                onOpenChange={vi.fn()}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
                footer={<Text accessibilityRole="button">Done</Text>}
            >
                <CountedField />
            </Sheet>,
        );

        // Just under half of 300: 64 + 80 = 144 <= 150, so the footer is pinned.
        layOut({ sheet: 300, topBlock: 64, footer: 80 });
        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);

        const field = screen.getByLabelText('Quantity');

        act(() => {
            field.focus();
        });
        expect(document.activeElement).toBe(field);

        // The keyboard shrinks the sheet: 144 > 120, so the footer moves into the scroll region.
        layOut({ sheet: 240, topBlock: 64, footer: 80 });
        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        expect(fieldMounts.count).toBe(1);
        expect(screen.getByLabelText('Quantity')).toBe(field);
        expect(document.activeElement).toBe(field);

        // The moved footer reports the same height from its new place: it stays where it was put.
        layOut({ sheet: 240, topBlock: 64, footer: 80 });
        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        expect(document.activeElement).toBe(field);
    });
});
