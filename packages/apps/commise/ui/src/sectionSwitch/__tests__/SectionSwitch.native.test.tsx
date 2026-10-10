import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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
