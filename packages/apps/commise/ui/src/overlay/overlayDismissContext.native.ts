/**
 * @module @commise/ui/overlay — the context an `OverlayHost` publishes its dismiss sink on.
 *
 * Its own module so the host and its descendants each import the context rather than each other. The default is
 * `null` and `useOverlayDismiss` throws without a host, for the reason `useBackIntercept` does: a close control that
 * silently does nothing is the defect this seam removes.
 */
import { createContext, useContext } from 'react';

import type { DismissRequest } from './dismissRoute.js';

/** The host's dismiss sink; `null` outside an `OverlayHost`. */
export const OverlayDismissContext = createContext<DismissRequest | null>(null);

/**
 * The dismiss sink of the enclosing `OverlayHost`.
 *
 * @returns The host's {@link DismissRequest}.
 * @throws When no `OverlayHost` is mounted above.
 */
export function useOverlayDismiss(): DismissRequest {
    const request = useContext(OverlayDismissContext);

    if (request === null) {
        throw new Error('useOverlayDismiss must be used inside an <OverlayHost>.');
    }

    return request;
}
