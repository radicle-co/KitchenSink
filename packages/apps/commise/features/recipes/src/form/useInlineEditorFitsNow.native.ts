/**
 * @module @commise/features-recipes/form — whether the screen has room for the row editor INLINE now (a tablet). The
 * native leaf of `./useInlineEditorFitsNow.ts`: the window's height in dp, and the root size as 16 scaled by the cook's
 * text size, through the one pure `editorFitsInline`.
 */
import { PixelRatio, useWindowDimensions } from 'react-native';

import { editorFitsInline } from './inlineEditorFit.js';

/** The default root size, in dp, which the cook's text size scales. */
const BASE_ROOT_DP = 16;

/**
 * Whether the screen has room for the inline row editor now.
 *
 * @param containerWidth - The content width, in dp, read once by the caller.
 * @returns The answer for the screen as it is now.
 */
export function useInlineEditorFitsNow(containerWidth: number): boolean {
    const { height } = useWindowDimensions();

    return editorFitsInline({
        viewportHeight: height,
        containerWidth,
        rootFontPx: BASE_ROOT_DP * PixelRatio.getFontScale(),
    });
}
