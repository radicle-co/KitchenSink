'use client';

/**
 * @module screenEnvironment/useWindowWidth — the window's width, px (web), re-read on resize. The server and the
 * hydrating render report 0, so server HTML and the first client render agree; the real width follows on the next
 * render. Internal to `@commise/ui`.
 */
import { useSyncExternalStore } from 'react';

/** Re-read after a resize. */
function subscribe(onChange: () => void): () => void {
    window.addEventListener('resize', onChange);

    return () => window.removeEventListener('resize', onChange);
}

/** @sideEffect Reads the window's width. */
const snapshot = (): number => window.innerWidth;

/** Unknown on the server. */
const serverSnapshot = (): number => 0;

/** The window's width, px. */
export function useWindowWidth(): number {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
