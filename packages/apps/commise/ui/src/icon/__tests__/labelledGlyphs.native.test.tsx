import { cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { ChoiceRow } from '../../choiceRow/ChoiceRow.native.js';
import { KeepAwakeToggle } from '../../keepAwake/KeepAwakeToggle.native.js';
import { SegmentedControl } from '../../segmentedControl/SegmentedControl.native.js';
import { StatusBadge } from '../../statusBadge/StatusBadge.native.js';

/**
 * Native: the glyph of a labelled control is its 1x size times its label's growth under the system text scale, to the
 * label's cap, and an icon-only segment keeps its size. The number a user sees is the stub's `iconSize`, which is what
 * the leaf hands the glyph.
 */

afterEach(cleanup);

/** Every glyph size the element draws at a system text scale, in document order. */
function glyphSizesAt(ui: ReactElement, scale: number): readonly string[] {
    const { container, unmount } = renderWithTamagui(ui, 'light', scale);
    const sizes = [...container.querySelectorAll<HTMLElement>('[data-commise-stub="icon"]')].map(
        (glyph) => glyph.dataset['iconSize'] ?? '',
    );

    unmount();

    return sizes;
}

const noop = (): void => undefined;

describe.each([
    {
        name: 'StatusBadge (caption, 16)',
        ui: <StatusBadge status="draft">Draft</StatusBadge>,
        sizes: ['16', '24', '32'],
    },
    {
        name: 'KeepAwakeToggle (label, 20)',
        ui: <KeepAwakeToggle on onChange={noop} label="Screen on" />,
        sizes: ['20', '30', '40'],
    },
    {
        name: 'ChoiceRow check (body, 20)',
        ui: (
            <ChoiceRow chosen busy={false} refused={false} accessibilityLabel="Easy, chosen" onPress={noop}>
                Easy
            </ChoiceRow>
        ),
        sizes: ['20', '30', '40'],
    },
    {
        name: 'SegmentedControl glyph (label, 20, chrome cap 1.5)',
        ui: (
            <SegmentedControl
                form="view"
                label="View"
                value="list"
                onChange={vi.fn()}
                segments={[{ id: 'list', label: 'List', icon: 'list' }]}
            />
        ),
        // The label stops at the 1.5 chrome cap, and so does the glyph: 30 at 3x, never 40.
        sizes: ['20', '30', '30'],
    },
])('$name grows with its label', ({ ui, sizes }) => {
    it('is its 1x size at 1x, grows at 1.5x, and stops at the cap at 3x', () => {
        expect([1, 1.5, 3].map((scale) => glyphSizesAt(ui, scale)[0])).toEqual(sizes);
    });
});

describe('SegmentedControl with its labels hidden', () => {
    it('keeps its glyph at 20 at the largest text, because an icon alone has no label to grow with', () => {
        const ui = (
            <SegmentedControl
                form="view"
                label="View"
                value="list"
                labelVisibility="hidden"
                onChange={vi.fn()}
                segments={[{ id: 'list', label: 'List', icon: 'list' }]}
            />
        );

        expect(glyphSizesAt(ui, 3)[0]).toBe('20');
    });
});
