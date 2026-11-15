/**
 * @module @commise/features-recipes/form — where the ingredient row editor opens, on web and native: INLINE in its row,
 * or as the sheet. One rule for both platforms; each platform's leaves measure the container and the window.
 *
 * The editor opens inline only when BOTH hold, and otherwise opens as the sheet: the window is at least
 * `INLINE_EDITOR_MIN_VIEWPORT_REM` high, and the editor's container at least `INLINE_EDITOR_MIN_CONTAINER_REM` wide,
 * both in rem at the cook's text size (`inlineEditorFit.ts`, which holds the measured values). The container's width is
 * read once, here, and also gives `wideContainer` (the 600 px `narrow` class, which the paste button placement uses).
 *
 * Nothing is held until the container has been measured (its width is 0 on the server and until then), so an editor that
 * opens on the first render, from a link, is not locked into the sheet by a width nobody had read yet.
 *
 * The room an OPEN editor started with is kept: a window that changes under it must not swap its
 * frame, which would remount its fields and drop the cook's caret. The answer is held in state adjusted during render,
 * from the render before (React's "store information from previous renders"), so no ref and no effect.
 */
import { containerClassOf } from '@commise/ui/container-class';
import { useState } from 'react';

import { useMainContainerWidth } from '../layout/useMainContainerWidth.js';
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
    const containerWidth = useMainContainerWidth();
    const wideContainer = containerClassOf(containerWidth) !== 'narrow';
    const fits = useInlineEditorFitsNow(containerWidth);
    const [held, setHeld] = useState<boolean | undefined>(undefined);

    if (!editorOpen && held !== undefined) {
        setHeld(undefined);
    } else if (editorOpen && held === undefined && containerWidth > 0) {
        setHeld(fits);
    }

    return { inline: held ?? fits, wideContainer };
}
