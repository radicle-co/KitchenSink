/**
 * The horizontal-scroll hint policy (`docs/design/uiOverhaul/horizontalScrollHint.md` §3.3): when the chevron and the
 * trailing fade show, from the numbers a scroller reports about itself.
 *
 * ⚠️ REWRITTEN from the `hasMoreAhead` table of `ChipRow.native.test.tsx` and the `railScrollState` rows of
 * `railScroll.test.ts`, both of which pinned a fade-only rule held in two places. The one rule is now here, and each
 * old row is translated: `viewport: 0` is the "unmeasured" row, the 338/339 pair is the end boundary, and the
 * right-to-left row is the `startOffsetOf` table.
 */
import { describe, expect, it } from 'vitest';

import {
    UNMEASURED_EXTENT,
    itemStepOf,
    scrollExtentOf,
    scrollHintOf,
    startOffsetOf,
    type ScrollGeometry,
} from '../scrollHint.js';

describe('scrollExtentOf and scrollHintOf', () => {
    // viewport 300, content 640: the end is at offset 340.
    const cases: ReadonlyArray<readonly [string, ScrollGeometry, boolean, boolean, boolean, boolean, boolean]> = [
        // name, geometry, measured, overflows, atStart, atEnd, → chevron below
        ['unmeasured: no box yet', { startOffset: 0, viewport: 0, content: 640 }, false, false, true, true, false],
        ['unmeasured: no content yet', { startOffset: 0, viewport: 300, content: 0 }, false, false, true, true, false],
        ['fits the box', { startOffset: 0, viewport: 400, content: 240 }, true, false, true, true, false],
        ['at the start', { startOffset: 0, viewport: 300, content: 640 }, true, true, true, false, true],
        ['in the middle', { startOffset: 120, viewport: 300, content: 640 }, true, true, false, false, false],
        ['at the end', { startOffset: 340, viewport: 300, content: 640 }, true, true, false, true, false],
        [
            'overscroll past the start (iOS bounce)',
            { startOffset: -30, viewport: 300, content: 640 },
            true,
            true,
            true,
            false,
            true,
        ],
        ['overscroll past the end', { startOffset: 380, viewport: 300, content: 640 }, true, true, false, true, false],
        // The 1 px slack, on both sides of each boundary.
        [
            '1 px from the start still counts as at the start',
            { startOffset: 1, viewport: 300, content: 640 },
            true,
            true,
            true,
            false,
            true,
        ],
        [
            '1.01 px from the start has left it',
            { startOffset: 1.01, viewport: 300, content: 640 },
            true,
            true,
            false,
            false,
            false,
        ],
        [
            '1 px short of the end is at the end',
            { startOffset: 339, viewport: 300, content: 640 },
            true,
            true,
            false,
            true,
            false,
        ],
        [
            '1.01 px short of the end is not',
            { startOffset: 338.99, viewport: 300, content: 640 },
            true,
            true,
            false,
            false,
            false,
        ],
        [
            'content 1 px wider than the box does not overflow',
            { startOffset: 0, viewport: 300, content: 301 },
            true,
            false,
            true,
            true,
            false,
        ],
        [
            'content 1.01 px wider than the box overflows',
            { startOffset: 0, viewport: 300, content: 301.01 },
            true,
            true,
            true,
            false,
            true,
        ],
    ];

    it.each(cases)('%s', (_name, geometry, measured, overflows, atStart, atEnd, chevron) => {
        const extent = scrollExtentOf(geometry);

        expect(extent).toEqual({ measured, overflows, atStart, atEnd });
        // The chevron needs a box that overflows AND rests at its start; the fade shows whenever more lies ahead.
        expect(scrollHintOf(extent)).toEqual({ chevron, fade: measured && !atEnd });
    });

    it('shows neither before it has measured, and neither when the content fits', () => {
        expect(scrollHintOf(UNMEASURED_EXTENT)).toEqual({ chevron: false, fade: false });
        expect(scrollHintOf(scrollExtentOf({ startOffset: 0, viewport: 400, content: 240 }))).toEqual({
            chevron: false,
            fade: false,
        });
    });

    it('keeps the fade while scrolled in the middle, and drops the chevron', () => {
        expect(scrollHintOf(scrollExtentOf({ startOffset: 120, viewport: 300, content: 640 }))).toEqual({
            chevron: false,
            fade: true,
        });
    });
});

describe('startOffsetOf', () => {
    // x, viewport, content, rtl, platform → distance from the START edge. Overscroll reads as 0.
    it.each([
        ['web left-to-right reads scrollLeft', 120, 300, 640, false, 'web', 120],
        ['web left-to-right clamps overscroll to 0', -12, 300, 640, false, 'web', 0],
        [
            'web right-to-left counts negative from 0, so the distance is its sign flipped',
            -120,
            300,
            640,
            true,
            'web',
            120,
        ],
        ['web right-to-left at rest is 0', 0, 300, 640, true, 'web', 0],
        ['web right-to-left clamps overscroll to 0', 8, 300, 640, true, 'web', 0],
        ['iOS left-to-right reads contentOffset.x', 120, 300, 640, false, 'ios', 120],
        ['iOS left-to-right clamps the bounce to 0', -30, 300, 640, false, 'ios', 0],
        ['iOS right-to-left is already start-relative', 120, 300, 640, true, 'ios', 120],
        ['Android left-to-right reads contentOffset.x', 120, 300, 640, false, 'android', 120],
        [
            'Android right-to-left counts from the physical left, so the start is content - viewport - x',
            340,
            300,
            640,
            true,
            'android',
            0,
        ],
        ['Android right-to-left, scrolled 120 toward the end', 220, 300, 640, true, 'android', 120],
        ['Android right-to-left clamps overscroll past the start to 0', 360, 300, 640, true, 'android', 0],
    ] as const)('%s', (_name, x, viewport, content, rtl, platform, expected) => {
        expect(startOffsetOf(x, viewport, content, rtl, platform)).toBe(expected);
    });
});

describe('itemStepOf', () => {
    it('moves by the distance between two items when there is a second, so the gap is included', () => {
        expect(itemStepOf(256, 272, 600)).toBe(272);
    });

    it('moves by the first item alone while there is no second', () => {
        expect(itemStepOf(256, 0, 600)).toBe(256);
    });

    it('moves by most of a view while no item is measured, and never by nothing', () => {
        expect(itemStepOf(0, 0, 600)).toBe(480);
        expect(itemStepOf(0, 0, 0)).toBe(1);
    });
});
