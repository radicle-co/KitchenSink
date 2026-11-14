/**
 * @module @commise/features-recipes/form — whether the screen has room for the row editor INLINE (a tablet), read where
 * the editor opens and held until it closes. The native leaf of `./useRoomForInlineEditor.ts`: the window's height in dp,
 * and the root size as 16 scaled by the cook's text size, through the one pure `editorFitsInline`.
 *
 * @pattern Observer — a subscription to the window's size, over the one pure `editorFitsInline`
 */
import { useState } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';

import { editorFitsInline } from './inlineEditorFit.js';

/** The default root size, in dp, which the cook's text size scales. */
const BASE_ROOT_DP = 16;

/**
 * Whether the row editor may open inline.
 *
 * @param editorOpen - Whether a row editor is open now.
 * @returns The answer the open editor started with while one is open, else the answer for the screen as it is now.
 */
export function useRoomForInlineEditor(editorOpen: boolean): boolean {
    const { height } = useWindowDimensions();
    const fits = editorFitsInline({ viewportHeight: height, rootFontPx: BASE_ROOT_DP * PixelRatio.getFontScale() });
    const [held, setHeld] = useState<boolean | undefined>(undefined);

    if (!editorOpen && held !== undefined) {
        setHeld(undefined);
    } else if (editorOpen && held === undefined) {
        setHeld(fits);
    }

    return held ?? fits;
}
