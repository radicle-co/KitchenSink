/**
 * @module @commise/features-recipes/form — whether the window has room for the row editor INLINE now
 * (`inlineEditorFit.ts`). `useRowEditorPlacement.ts` holds the answer while an editor is open.
 *
 * The window's height and the root font size are read through `useSyncExternalStore`, so a resize or a text-size change
 * is read on the next render.
 *
 * @pattern Observer — a subscription to the window's size and the root's style, over the one pure `editorFitsInline`
 */
import { useSyncExternalStore } from 'react';

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
 * Whether the window has room for the inline row editor now.
 *
 * @returns The answer for the window as it is now. On the server, `true`: a wide container draws the inline editor.
 * @sideEffect Subscribes to the window's size and the root element's style for the component's life.
 */
export function useInlineEditorFitsNow(): boolean {
    return useSyncExternalStore(subscribe, fitsNow, () => true);
}
