/**
 * @module @commise/features-recipes/form — where the ingredient row editor opens, on web and native: INLINE in its row,
 * or as the sheet. One rule for both platforms; each platform's leaves measure the container and the window.
 *
 * The editor opens inline only in a container that is not narrow (§7.5.2, §7.12) and in a window with room for it
 * (`inlineEditorFit.ts`). The room an OPEN editor started with is kept: a window that changes under it must not swap its
 * frame, which would remount its fields and drop the cook's caret. The answer is held in state adjusted during render,
 * from the render before (React's "store information from previous renders"), so no ref and no effect.
 */
import { useState } from 'react';

import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { useInlineEditorFitsNow } from './useInlineEditorFitsNow.js';

/** Where the row editor opens, and whether the container is wide enough for controls beside the add field. */
export interface RowEditorPlacement {
    /** The row editor opens inline in its row; otherwise as the sheet. */
    readonly inline: boolean;
    /** The main container is not narrow. */
    readonly wideContainer: boolean;
}

/**
 * Where the row editor opens.
 *
 * @param editorOpen - Whether a row editor is open now.
 * @returns `inline` from the room the open editor started with while one is open, else from the window as it is now.
 */
export function useRowEditorPlacement(editorOpen: boolean): RowEditorPlacement {
    const wideContainer = useMainContainerClass() !== 'narrow';
    const fits = useInlineEditorFitsNow();
    const [held, setHeld] = useState<boolean | undefined>(undefined);

    if (!editorOpen && held !== undefined) {
        setHeld(undefined);
    } else if (editorOpen && held === undefined) {
        setHeld(fits);
    }

    return { inline: (held ?? fits) && wideContainer, wideContainer };
}
