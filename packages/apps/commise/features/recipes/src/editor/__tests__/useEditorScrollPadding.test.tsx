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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
