import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text, View } from 'react-native';

import { role } from '../../tokens/colors.js';

import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import type { ScrollHostApi } from '../../scrollHost/props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { SectionSwitch } from '../SectionSwitch.native.js';

/**
 * The native `SectionSwitch` (build spec §6.2): the section links as `link`s, the current one selected, and a press
 * that jumps through the screen's ONE scroll host (`useScrollHost().scrollToSection`, blueprint A7), the same call the
 * web leaf makes, then reports the section. The host is a recording stand-in: the scroll itself is `ScrollHost`'s, and
 * its own suite owns it.
 */

/** A host that records the jumps it is asked for. */
function recordingHost(): { readonly api: ScrollHostApi; readonly jumps: string[] } {
    const jumps: string[] = [];
    const api: ScrollHostApi = {
        condensed: false,
        scrollingDown: false,
        atTop: true,
        current: undefined,
        onCurrentChange: () => () => undefined,
        viewportsDown: 0,
        pageViewports: 1,
        scrollToTop: () => undefined,
        scrollToSection: (id) => {
            jumps.push(id);
        },
        scrollToField: () => false,
        revealSpan: () => false,
        headingLayout: () => undefined,
        sectionLayout: () => () => undefined,
        handle: { current: null },
    };

    return { api, jumps };
}

afterEach(cleanup);

const SECTIONS = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'steps', label: 'Steps' },
] as const;

describe('SectionSwitch (native)', () => {
    it('jumps through the scroll host, reports the pressed section and marks the current one', () => {
        const onJump = vi.fn();
        const host = recordingHost();
        render(
            <ScrollHostContext.Provider value={host.api}>
                <SectionSwitch label="Recipe sections" sections={SECTIONS} currentId="ingredients" onJump={onJump} />
            </ScrollHostContext.Provider>,
        );

        const steps = screen.getByRole('link', { name: 'Steps' });
        fireEvent.click(steps);

        expect(host.jumps).toEqual(['steps']);
        expect(onJump).toHaveBeenCalledWith('steps');
        expect(screen.getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBe('location');
        expect(steps.getAttribute('aria-current')).toBeNull();
    });
});

/**
 * The native bar used to lay its links in a `flex: 1` row with no scroller, so at a large font they were squeezed or cut
 * (`docs/design/uiOverhaul/horizontalScrollHint.md` §1a). They now scroll inside the bar, in the design-system
 * `HorizontalScroller`, and the trailing control stays pinned outside it.
 */
describe('SectionSwitch (native) — scrolling links', () => {
    const FADE = '[data-commise-stub="linear-gradient"]';

    /** Report a laid-out size to a view, the way react-native-web's ResizeObserver does. */
    function layOut(element: Element, width: number): void {
        const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

        act(() => handler?.({ nativeEvent: { layout: { x: 0, y: 0, width, height: 48 } } }));
    }

    const measured = (container: HTMLElement): Element[] =>
        [...container.querySelectorAll('*')].filter(
            (node) => (node as Element & { __reactLayoutHandler?: unknown }).__reactLayoutHandler !== undefined,
        );

    function bar() {
        return render(
            <ScrollHostContext.Provider value={recordingHost().api}>
                <SectionSwitch
                    label="Recipe sections"
                    sections={SECTIONS}
                    trailing={
                        <View>
                            <Text>Screen on</Text>
                        </View>
                    }
                />
            </ScrollHostContext.Provider>,
        );
    }

    it('holds its links in a scroller, and the trailing control outside it', () => {
        const { container } = bar();
        const [scroller] = measured(container);

        expect(scroller?.contains(screen.getByRole('link', { name: 'Steps' }))).toBe(true);
        expect(scroller?.contains(screen.getByText('Screen on'))).toBe(false);
    });

    it('hints at more links with the chevron on a band into the bar’s own surface', () => {
        const { container } = bar();
        const [scroller, content] = measured(container);

        layOut(scroller as Element, 120);
        layOut(content as Element, 360);

        const fade = container.querySelector<HTMLElement>(FADE);

        expect(fade?.dataset['colors']?.endsWith(`|${role.paper}`)).toBe(true);
        expect(container.querySelector('[data-icon-name="chevron-right"]')).not.toBeNull();
    });

    it('draws no hint while the links fit', () => {
        const { container } = bar();
        const [scroller, content] = measured(container);

        layOut(scroller as Element, 400);
        layOut(content as Element, 200);

        expect(container.querySelector(FADE)).toBeNull();
    });
});
