// @vitest-environment jsdom
/**
 * The web editor's scroll padding (`useEditorScrollPadding`): the document keeps a focused control, and a deep link's
 * jump, clear of the sticky header and the action bar. The padding is read from the page as it is laid out when the hook
 * applies it, never from the bar's height as a LATER commit measured it: a link's jump runs in the same commit the
 * editor mounts, and a padding that waited for the measured height was `auto` while the jump read it, so the jump put
 * Done and Cancel under the bar (text at 200%).
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EDITOR_ACTION_BAR_ID, EDITOR_HEADER_ID } from '../frameProps.js';
import { useEditorScrollPadding } from '../useEditorScrollPadding.js';

const Probe = ({ bar }: { readonly bar: { readonly pinned: boolean; readonly height: number } }): null => {
    useEditorScrollPadding(bar);

    return null;
};

/** A box at a place in the viewport. */
function box(id: string, rect: { readonly top: number; readonly bottom: number }): void {
    const node = document.createElement('div');
    node.id = id;
    node.getBoundingClientRect = () => ({ ...rect, height: rect.bottom - rect.top }) as DOMRect;
    document.body.append(node);
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
        render(<Probe bar={{ pinned: false, height: 0 }} />);

        expect(document.documentElement.style.scrollPaddingTop).toBe('208px');
        // The bar holds the foot of the window, 112 px tall, and a control keeps 16 px clear of it.
        expect(document.documentElement.style.scrollPaddingBottom).toBe('128px');
    });

    it('asks for no bottom padding while the bar scrolls with the page, and puts both edges back on unmount', () => {
        document.getElementById(EDITOR_ACTION_BAR_ID)?.remove();
        box(EDITOR_ACTION_BAR_ID, { top: 1200, bottom: 1312 });
        const view = render(<Probe bar={{ pinned: false, height: 0 }} />);

        expect(document.documentElement.style.scrollPaddingBottom).toBe('');

        view.unmount();

        expect(document.documentElement.style.scrollPaddingTop).toBe('');
    });
});
