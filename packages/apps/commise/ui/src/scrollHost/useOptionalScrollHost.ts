/**
 * @module @commise/ui/scroll-host — the optional read of the nearest `ScrollHost`, for a control that works without one.
 */
import { useContext } from 'react';

import type { ScrollHostApi } from './props.js';
import { ScrollHostContext } from './scrollHostContext.js';

/**
 * The nearest `ScrollHost`'s state, or `null` outside one: for a control that scrolls the page as a courtesy and works
 * without it (an ingredient row's arrival, in a test or a screen with no host).
 *
 * @returns The host's API, or `null`.
 */
export function useOptionalScrollHost(): ScrollHostApi | null {
    return useContext(ScrollHostContext);
}
