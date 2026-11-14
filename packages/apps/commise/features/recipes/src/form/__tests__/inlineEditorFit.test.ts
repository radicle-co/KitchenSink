/**
 * Whether the row editor may open INLINE (`inlineEditorFit.ts`): only when the window is tall enough, in the cook's own
 * text size, for the editor to show whole between the sticky header and the action bar. Otherwise it opens as the
 * sheet, whose Done and Cancel stay pinned. The threshold is in rem, so a larger text size needs a taller window.
 */
import { describe, expect, it } from 'vitest';

import {
    INLINE_EDITOR_MIN_CONTAINER_REM,
    INLINE_EDITOR_MIN_VIEWPORT_REM,
    editorFitsInline,
} from '../inlineEditorFit.js';

/** A container far wider than the threshold, so a case about the height is only about the height. */
const WIDE = 2000;
/** A window far taller than the threshold, so a case about the width is only about the width. */
const TALL = 3000;

describe('editorFitsInline', () => {
    // The measured values (needsReviewJump.spec.ts, 2026-11-14), written out here so a change to a constant is a decision
    // in two places and not one that passes by deriving its own expectation.
    it('pins the measured thresholds at 46 rem high and 43 rem wide', () => {
        expect(INLINE_EDITOR_MIN_VIEWPORT_REM).toBe(46);
        expect(INLINE_EDITOR_MIN_CONTAINER_REM).toBe(43);
    });

    it.each([
        ['exactly 46 rem high and 43 rem wide at the default size', 46 * 16, 43 * 16, 16],
        ['a tall, wide window at the default size', 1200, 1200, 16],
        ['exactly 46 rem high and 43 rem wide at a text size a little larger', 46 * 17, 43 * 17, 17],
        ['exactly 46 rem high and 43 rem wide at 200% text', 46 * 32, 43 * 32, 32],
    ])('fits: %s', (_name, viewportHeight, containerWidth, rootFontPx) => {
        expect(editorFitsInline({ viewportHeight, containerWidth, rootFontPx })).toBe(true);
    });

    it.each([
        ['one pixel under 46 rem high', 46 * 16 - 1, WIDE, 16],
        ['45 rem high', 45 * 16, WIDE, 16],
        ['200% text, one pixel under 46 rem high', 46 * 32 - 1, WIDE * 2, 32],
        ['200% text in a 1200 px window', 1200, WIDE * 2, 32],
        ['one pixel under 43 rem wide', TALL, 43 * 16 - 1, 16],
        ['42 rem wide', TALL, 42 * 16, 16],
        ['200% text, one pixel under 43 rem wide', TALL * 2, 43 * 32 - 1, 32],
        ['a phone: tall, but only 22 rem wide', 844, 358, 16],
    ])('does not fit: %s', (_name, viewportHeight, containerWidth, rootFontPx) => {
        expect(editorFitsInline({ viewportHeight, containerWidth, rootFontPx })).toBe(false);
    });

    it('counts both thresholds themselves as fitting', () => {
        expect(
            editorFitsInline({
                viewportHeight: INLINE_EDITOR_MIN_VIEWPORT_REM * 20,
                containerWidth: INLINE_EDITOR_MIN_CONTAINER_REM * 20,
                rootFontPx: 20,
            }),
        ).toBe(true);
    });

    it('treats a root size it cannot read as the default 16 px, never as a reason to hide the inline editor', () => {
        expect(editorFitsInline({ viewportHeight: 1200, containerWidth: WIDE, rootFontPx: Number.NaN })).toBe(true);
        expect(editorFitsInline({ viewportHeight: 1200, containerWidth: WIDE, rootFontPx: 0 })).toBe(true);
    });
});
