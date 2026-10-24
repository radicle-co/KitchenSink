/**
 * The pinned-footer limit (`docs/design/compactHeightLayout.md` §3.1; `ingredientSpecialization.md` §S8.1, finding I7;
 * owner ruling, option B "unpin past a limit"): when the pinned top row (the one that holds the exit) and the footer
 * together are TALLER than half the frame, the footer scrolls with the content. The exit stays pinned. One rule, read
 * by the Sheet and by the recipe wizard.
 */
import { describe, expect, it } from 'vitest';

import { isFooterUnpinned, pinnedFooterMeasureOf } from '../pinnedFooter.js';

describe('isFooterUnpinned', () => {
    it.each([
        // pinned top, footer, frame, unpinned — the reason
        [56, 80, 600, false, 'a phone held upright at 100% text: the chrome is a quarter of the frame'],
        [61, 69, 779, false, 'the wizard upright: U32 keeps its pinned bar'],
        [61, 69, 369, false, 'the wizard sideways with the keyboard closed'],
        [61, 69, 149, true, 'the wizard sideways with the keyboard open'],
        [56, 80, 272, false, 'exactly half is not MORE than half'],
        [56, 80, 271, true, 'one past half'],
        [120, 160, 400, true, 'large text: the chrome alone is 70% of the frame'],
    ])('pinned top %d + footer %d in a %d frame → unpinned %s (%s)', (pinnedTop, footer, frame, unpinned) => {
        expect(isFooterUnpinned({ pinnedTop, footer, frame })).toBe(unpinned);
    });

    it('stays pinned until the frame is measured', () => {
        expect(isFooterUnpinned({ pinnedTop: 56, footer: 80, frame: 0 })).toBe(false);
    });

    it('stays pinned until the footer is measured', () => {
        expect(isFooterUnpinned({ pinnedTop: 56, footer: 0, frame: 100 })).toBe(false);
    });

    // The Sheet's toolbar is NOT an input: the owner's words name the title row and the footer only. A caller that
    // added it to `pinnedTop` would unpin earlier than the ruling allows, which this row pins down.
    it('reads only the pinned top row and the footer, so a toolbar between them does not count', () => {
        const titleRow = 56;
        const toolbar = 60;
        const footer = 80;

        expect(isFooterUnpinned({ pinnedTop: titleRow, footer, frame: 300 })).toBe(false);
        expect(isFooterUnpinned({ pinnedTop: titleRow + toolbar, footer, frame: 300 })).toBe(true);
    });
});

/**
 * The heights the rule reads (`docs/design/compactHeightLayout.md` A1, §4). A footer laid out in the pinned top row's own
 * flow (the web wizard's bar in its header band at `lg`) is counted there once: the top row is measured without it, so
 * the chrome measures the same in either slot, and a footer the rule just moved is not judged on different numbers and
 * moved straight back (§3.1). Moved here from the wizard's own copy of this rule.
 */
describe('pinnedFooterMeasureOf', () => {
    it.each([
        {
            name: 'a footer outside the top row: fixed to the foot, or following the content',
            heights: { topHeight: 64, footerHeight: 62, footerInTop: false, frameHeight: 844 },
            measure: { pinnedTop: 64, footer: 62, frame: 844 },
        },
        {
            name: 'a footer in the top row’s flow: the top row’s height counts it, once',
            heights: { topHeight: 180, footerHeight: 52, footerInTop: true, frameHeight: 400 },
            measure: { pinnedTop: 128, footer: 52, frame: 400 },
        },
        {
            name: 'the same chrome with the footer moved out, which measures the same',
            heights: { topHeight: 128, footerHeight: 52, footerInTop: false, frameHeight: 400 },
            measure: { pinnedTop: 128, footer: 52, frame: 400 },
        },
        {
            name: '640 × 360 at 200% text (v3Evaluation.md case D)',
            heights: { topHeight: 137, footerHeight: 121, footerInTop: false, frameHeight: 360 },
            measure: { pinnedTop: 137, footer: 121, frame: 360 },
        },
    ] as const)('$name', ({ heights, measure }) => {
        expect(pinnedFooterMeasureOf(heights)).toEqual(measure);
    });
});
