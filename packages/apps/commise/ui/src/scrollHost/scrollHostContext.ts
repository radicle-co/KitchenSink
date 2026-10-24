/**
 * @module @commise/ui/scroll-host — the context a `ScrollHost` publishes its state through, and the hook its screen's
 * chrome reads it with.
 */
import { createContext, useContext } from 'react';

import type { ScrollHostApi } from './props.js';

/** The nearest host's state; `null` outside any host. */
export const ScrollHostContext = createContext<ScrollHostApi | null>(null);

/**
 * The nearest `ScrollHost`'s state.
 *
 * @returns The host's API.
 * @throws Error outside a `ScrollHost`: a floating button or a condensed bar with no scroller to read is a wiring
 *     defect, and a silent default would hide it.
 */
export function useScrollHost(): ScrollHostApi {
    const host = useContext(ScrollHostContext);

    if (host === null) {
        throw new Error('useScrollHost() needs a <ScrollHost> above it.');
    }

    return host;
}
