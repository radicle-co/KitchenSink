// @vitest-environment jsdom
/**
 * The web editor's scroll padding (`useEditorScrollPadding`): the document keeps a focused control, and a deep link's
 * jump, clear of the sticky header and the action bar. The padding is read from the page as it is laid out when the hook
 * applies it, never from the bar's height as a LATER commit measured it: a link's jump runs in the same commit the
 * editor mounts, and a padding that waited for the measured height was `auto` while the jump read it, so the jump put
 * Done and Cancel under the bar (text at 200%).
 */
import { cleanup, render } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_ACTION_BAR_ID, EDITOR_HEADER_ID, EDITOR_INDEX_ID } from '../frameProps.js';
import { useEditorScrollPadding } from '../useEditorScrollPadding.js';

interface Bar {
    readonly pinned: boolean;
    readonly height: number;
    readonly topHeight: number;
}

const Probe: FC<{ readonly bar: Bar }> = ({ bar }) => {
    useEditorScrollPadding(bar);

    return null;
};

/** A box at a place in the viewport. */
function box(id: string, rect: { readonly top: number; readonly bottom: number }): HTMLElement {
    const node = document.createElement('div');
    node.id = id;
    node.getBoundingClientRect = () => ({ ...rect, height: rect.bottom - rect.top }) as DOMRect;
    document.body.append(node);

    return node;
}

beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
    box(EDITOR_HEADER_ID, { top: 0, bottom: 208 });
    box(EDITOR_ACTION_BAR_ID, { top: 688, bottom: 800 });
});

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('style');
});

describe('useEditorScrollPadding', () => {
    // The state that measures the bar has not answered yet when the hook first applies: `pinned: false, height: 0`.
    it('pads both edges from the layout on the first commit, before the bar’s height has been measured', () => {
        render(<Probe bar={{ pinned: false, height: 0, topHeight: 0 }} />);

        expect(document.documentElement.style.scrollPaddingTop).toBe('208px');
        // The bar holds the foot of the window, 112 px tall, and a control keeps 16 px clear of it.
        expect(document.documentElement.style.scrollPaddingBottom).toBe('128px');
    });

    it('asks for no bottom padding while the bar scrolls with the page, and puts both edges back on unmount', () => {
        document.getElementById(EDITOR_ACTION_BAR_ID)?.remove();
        box(EDITOR_ACTION_BAR_ID, { top: 1200, bottom: 1312 });
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 0 }} />);

        expect(document.documentElement.style.scrollPaddingBottom).toBe('');

        view.unmount();

        expect(document.documentElement.style.scrollPaddingTop).toBe('');
    });

    // The chrome's HEIGHTS, not where it happens to sit: at scroll 0 the section bar has not stuck yet, so its bottom edge
    // includes the gutter above it, and a scrolled page puts the header's bottom edge anywhere.
    it('sums the heights of the header and the section bar, whatever the scroll position', () => {
        const strip = box(`${EDITOR_INDEX_ID}-strip`, { top: 300, bottom: 344 });
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);

        // 208 (header) + 44 (strip): the strip's bottom edge (344) is not what the page needs cleared.
        expect(document.documentElement.style.scrollPaddingTop).toBe('252px');

        // The page scrolls: every edge moves up by 90, and the heights are the same.
        const header = document.getElementById(EDITOR_HEADER_ID);

        if (header === null) {
            throw new Error('the header box is not there');
        }

        header.getBoundingClientRect = () => ({ top: -90, bottom: 118, height: 208 }) as DOMRect;
        strip.getBoundingClientRect = () => ({ top: 0, bottom: 44, height: 44 }) as DOMRect;
        view.rerender(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);
        window.dispatchEvent(new Event('resize'));

        expect(document.documentElement.style.scrollPaddingTop).toBe('252px');
    });

    it('reads the page again when the header’s measured height changes (a header that wraps)', () => {
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);

        expect(document.documentElement.style.scrollPaddingTop).toBe('208px');

        const header = document.getElementById(EDITOR_HEADER_ID);

        if (header === null) {
            throw new Error('the header box is not there');
        }

        header.getBoundingClientRect = () => ({ top: 0, bottom: 280, height: 280 }) as DOMRect;
        view.rerender(<Probe bar={{ pinned: false, height: 0, topHeight: 280 }} />);

        expect(document.documentElement.style.scrollPaddingTop).toBe('280px');
    });
});

/**
 * The header can GROW after the focus scroll placed a control at the old chrome's edge (Done keeps an edit and the save status
 * wraps at 200% text). The new padding applies to the next scroll only, so a focused control now under the chrome is brought
 * back with the padding just set, and nothing else is scrolled.
 */
describe('useEditorScrollPadding — a header that grows over the focused control', () => {
    /** A focused control inside `main`, with the header's box at `headerHeight`. */
    function setUp(
        controlTop: number,
        headerHeight: number,
    ): { readonly scrolled: ReturnType<typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>> } {
        document.getElementById(EDITOR_HEADER_ID)?.remove();
        const main = document.createElement('main');
        const header = box(EDITOR_HEADER_ID, { top: 0, bottom: headerHeight });
        const control = document.createElement('button');
        const scrolled = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();

        control.getBoundingClientRect = () => ({ top: controlTop, bottom: controlTop + 48, height: 48 }) as DOMRect;
        control.scrollIntoView = scrolled;
        main.append(header, control);
        document.body.append(main);
        control.focus();

        return { scrolled };
    }

    /** Re-measure: the header is now `height` tall. */
    function growTo(height: number, view: ReturnType<typeof render>): void {
        const header = document.getElementById(EDITOR_HEADER_ID);

        if (header === null) {
            throw new Error('no header');
        }

        header.getBoundingClientRect = () => ({ top: 0, bottom: height, height }) as DOMRect;
        view.rerender(<Probe bar={{ pinned: false, height: 0, topHeight: height }} />);
    }

    it('grew, and the focused control is now under it: scrolls it nearest, by the padding just set', () => {
        const { scrolled } = setUp(208, 208);
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);

        expect(scrolled).not.toHaveBeenCalled();

        growTo(257, view);

        expect(document.documentElement.style.scrollPaddingTop).toBe('257px');
        expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    });

    it('grew, and the focused control is still clear: no scroll', () => {
        const { scrolled } = setUp(346, 208);
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);

        growTo(257, view);

        expect(scrolled).not.toHaveBeenCalled();
    });

    it('shrank: no scroll', () => {
        const { scrolled } = setUp(100, 257);
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 257 }} />);

        growTo(208, view);

        expect(scrolled).not.toHaveBeenCalled();
    });

    it('nothing in the editor has focus: no scroll', () => {
        const { scrolled } = setUp(208, 208);
        const outside = document.createElement('button');

        document.body.append(outside);
        outside.focus();
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 208 }} />);

        growTo(257, view);

        expect(scrolled).not.toHaveBeenCalled();
    });
});

/**
 * The header can grow while a sheet is open (Done keeps an edit and the save status wraps at 200% text), and the sheet then
 * hands focus back to a row sitting at the OLD chrome edge. The browser does not scroll a partly covered element on focus, so a
 * control that takes focus under the chrome is brought back with the padding in force.
 */
describe('useEditorScrollPadding — focus that lands under the chrome', () => {
    // The reveal waits one frame, for the sheet's own scroll restore; the test runs the frame at once.
    beforeEach(() => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);

            return 0;
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setUp(controlTop: number): {
        readonly control: HTMLButtonElement;
        readonly scrolled: ReturnType<typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>>;
    } {
        document.getElementById(EDITOR_HEADER_ID)?.remove();
        const main = document.createElement('main');
        const header = box(EDITOR_HEADER_ID, { top: 0, bottom: 257 });
        const control = document.createElement('button');
        const scrolled = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();

        control.getBoundingClientRect = () => ({ top: controlTop, bottom: controlTop + 48, height: 48 }) as DOMRect;
        control.scrollIntoView = scrolled;
        main.append(header, control);
        document.body.append(main);

        return { control, scrolled };
    }

    it('scrolls a control nearest when it takes focus under the chrome', () => {
        const { control, scrolled } = setUp(208);
        render(<Probe bar={{ pinned: false, height: 0, topHeight: 257 }} />);

        control.focus();

        expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    });

    it('does nothing for a control that takes focus clear of the chrome', () => {
        const { control, scrolled } = setUp(346);
        render(<Probe bar={{ pinned: false, height: 0, topHeight: 257 }} />);

        control.focus();

        expect(scrolled).not.toHaveBeenCalled();
    });

    it('does nothing for focus outside the editor, or in the chrome itself', () => {
        const { scrolled } = setUp(208);
        const outside = document.createElement('button');
        outside.getBoundingClientRect = () => ({ top: 0, bottom: 48, height: 48 }) as DOMRect;
        outside.scrollIntoView = scrolled;
        document.body.append(outside);
        const inChrome = document.createElement('button');
        inChrome.getBoundingClientRect = () => ({ top: 0, bottom: 48, height: 48 }) as DOMRect;
        inChrome.scrollIntoView = scrolled;
        document.getElementById(EDITOR_HEADER_ID)?.append(inChrome);
        render(<Probe bar={{ pinned: false, height: 0, topHeight: 257 }} />);

        outside.focus();
        inChrome.focus();

        expect(scrolled).not.toHaveBeenCalled();
    });

    it('stops listening when the editor goes', () => {
        const { control, scrolled } = setUp(208);
        const view = render(<Probe bar={{ pinned: false, height: 0, topHeight: 257 }} />);

        view.unmount();
        control.focus();

        expect(scrolled).not.toHaveBeenCalled();
    });
});
