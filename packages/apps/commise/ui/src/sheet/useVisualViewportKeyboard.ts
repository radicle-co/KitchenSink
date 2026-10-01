/**
 * @module @commise/ui/sheet — the web sheet's reading of an on-screen keyboard.
 *
 * A mobile browser's keyboard shrinks the VISUAL viewport and leaves the layout viewport alone, so the keyboard is
 * the gap between `window.innerHeight` and `visualViewport.height`, read at scale 1 so a pinch-zoom never counts.
 * While it is open the sheet needs the visible BOX, not only its height: the box's top is `visualViewport.offsetTop`,
 * which iOS moves by panning the page under the keyboard (a viewport `scroll`, not a `resize`). Without it the sheet
 * centred on the whole window and the keyboard hid 100 to 199 px of it (E2 I5).
 *
 * @pattern Adapter over `window.visualViewport` — `useSyncExternalStore` is the subscription (Observer); the rule is
 *     `isOnScreenKeyboard`.
 */
import { useSyncExternalStore } from 'react';

import { isOnScreenKeyboard } from './onScreenKeyboard.js';

/** The part of the window an on-screen keyboard leaves visible, in px from the layout viewport's top. */
interface VisibleViewport {
    /** The visible height. */
    readonly height: number;
    /** Where the visible box starts: the visual viewport's offset from the layout viewport's top. */
    readonly top: number;
}

/**
 * Re-read on a viewport resize, a viewport scroll or a window resize. A resize opens or closes the keyboard; a scroll
 * is iOS panning the visible box.
 */
function subscribe(onChange: () => void): () => void {
    const viewport = window.visualViewport;

    viewport?.addEventListener('resize', onChange);
    viewport?.addEventListener('scroll', onChange);
    window.addEventListener('resize', onChange);

    return () => {
        viewport?.removeEventListener('resize', onChange);
        viewport?.removeEventListener('scroll', onChange);
        window.removeEventListener('resize', onChange);
    };
}

/** The visible height while an on-screen keyboard is open, else `null`. */
function heightSnapshot(): number | null {
    const viewport = window.visualViewport;

    if (viewport === null || viewport === undefined) {
        return null;
    }

    return isOnScreenKeyboard(window.innerHeight - viewport.height, viewport.scale)
        ? Math.round(viewport.height)
        : null;
}

/**
 * The visible box's top. A number rather than an object, so the snapshot is stable between reads without a cache
 * (`useSyncExternalStore` compares snapshots with `Object.is`).
 */
function topSnapshot(): number {
    return Math.round(window.visualViewport?.offsetTop ?? 0);
}

/** The server renders with no keyboard, so no visible height… */
const serverHeight = (): null => null;
/** …and the window's own top. */
const serverTop = (): number => 0;

/**
 * The visible box, in px, while an on-screen keyboard is open.
 *
 * @returns The visual viewport's height and top while a keyboard hides at least 150 px at scale 1; `null` otherwise,
 *   and where the browser has no visual viewport.
 * @sideEffect Listens for viewport resizes and scrolls and for window resizes while mounted.
 */
export function useVisualViewportKeyboard(): VisibleViewport | null {
    const height = useSyncExternalStore(subscribe, heightSnapshot, serverHeight);
    const top = useSyncExternalStore(subscribe, topSnapshot, serverTop);

    return height === null ? null : { height, top };
}
