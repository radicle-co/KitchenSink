/**
 * Whether the row editor may open INLINE (`inlineEditorFit.ts`): only when the window is tall enough, in the cook's own
 * text size, for the editor to show whole between the sticky header and the action bar. Otherwise it opens as the
 * sheet, whose Done and Cancel stay pinned. The threshold is in rem, so a larger text size needs a taller window.
 */
import { describe, expect, it } from 'vitest';

import { INLINE_EDITOR_MIN_VIEWPORT_REM, editorFitsInline } from '../inlineEditorFit.js';

describe('editorFitsInline', () => {
    it.each([
        ['a laptop window at the default size', 800, 16],
        ['the shortest window the editor was drawn for', 736, 16],
        ['the same window and a text size a little larger', 800, 17],
    ])('fits: %s', (_name, viewportHeight, rootFontPx) => {
        expect(editorFitsInline({ viewportHeight, rootFontPx })).toBe(true);
    });

    it.each([
        ['200% text in an 800 px window', 800, 32],
        ['a short window at the default size', 600, 16],
        ['one pixel under the threshold', INLINE_EDITOR_MIN_VIEWPORT_REM * 16 - 1, 16],
    ])('does not fit: %s', (_name, viewportHeight, rootFontPx) => {
        expect(editorFitsInline({ viewportHeight, rootFontPx })).toBe(false);
    });

    it('counts the threshold itself as fitting', () => {
        expect(editorFitsInline({ viewportHeight: INLINE_EDITOR_MIN_VIEWPORT_REM * 20, rootFontPx: 20 })).toBe(true);
    });

    it('treats a root size it cannot read as the default 16 px, never as a reason to hide the inline editor', () => {
        expect(editorFitsInline({ viewportHeight: 800, rootFontPx: Number.NaN })).toBe(true);
        expect(editorFitsInline({ viewportHeight: 800, rootFontPx: 0 })).toBe(true);
    });
});
