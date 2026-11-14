/**
 * @module @commise/features-recipes/form — whether the page has room for the row editor INLINE, read where the editor
 * opens and held until it closes (`inlineEditorFit.ts`).
 *
 * The window's height and the root font size are read through `useSyncExternalStore`, so a resize or a text-size change
 * is read the next time the editor opens. The answer an OPEN editor started with is kept: a window that changes under it
 * must not swap its frame, which would remount its fields and drop the cook's caret. The frame is held in state adjusted
 * during render, from the render before (React's "store information from previous renders"), so no ref and no effect.
 *
 * @pattern Observer — a subscription to the window's size and the root's style, over the one pure `editorFitsInline`
 */
import { useState, useSyncExternalStore } from 'react';

import { editorFitsInline } from './inlineEditorFit.js';

/** Hear the window resize, and the root's style or class change (a text-size setting a page applies to <html>). */
function subscribe(listener: () => void): () => void {
    window.addEventListener('resize', listener);
    const observer = new MutationObserver(listener);

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

    return () => {
        window.removeEventListener('resize', listener);
        observer.disconnect();
    };
}

/** Whether the window holds the inline editor now. @sideEffect Reads layout: the root's computed font size. */
function fitsNow(): boolean {
    return editorFitsInline({
        viewportHeight: window.innerHeight,
        rootFontPx: Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
    });
}

/**
 * Whether the row editor may open inline.
 *
 * @param editorOpen - Whether a row editor is open now.
 * @returns The answer the open editor started with while one is open, else the answer for the window as it is now.
 * @sideEffect Subscribes to the window's size and the root element's style for the component's life.
 */
export function useRoomForInlineEditor(editorOpen: boolean): boolean {
    // On the server there is no window: the inline editor, which a wide container draws anyway.
    const fits = useSyncExternalStore(subscribe, fitsNow, () => true);
    const [held, setHeld] = useState<boolean | undefined>(undefined);

    if (!editorOpen && held !== undefined) {
        setHeld(undefined);
    } else if (editorOpen && held === undefined) {
        setHeld(fits);
    }

    return held ?? fits;
}
