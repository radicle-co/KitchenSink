/**
 * @module @commise/ui/overlay — the window every sheet and dialog opens in, and the one door their dismissals use.
 *
 * An open `Modal` takes Android Back itself and calls `onRequestClose`; no `BackHandler` event is emitted while one is
 * up. So a Back interceptor registered inside a window, on the provider's registry, is on a chain no press can reach.
 * The host fixes both halves: it turns Back into a `DismissRequest` after asking the window's OWN interceptors, and it
 * publishes that sink so the scrim, the Close control and the swipe raise the same request.
 *
 * - The host owns `open`. It is a controlled component: the content never keeps its own open state, and a request the
 *   host ignores leaves the overlay up (the discard guard, the `submitting` veto).
 * - The scope is a registry of its own. It does NOT join the ancestor provider's chain, because the ancestor's
 *   `BackHandler` is not live while this window is up.
 * - `visible` passes through unchanged: a sheet keeps the Modal mounted, a dialog unmounts it. No mode prop.
 *
 * An orchestration component: it renders no surface of its own and decides who answers a dismissal.
 *
 * @pattern Adapter over the design-system `Modal` — every platform dismissal becomes one `DismissRequest(route)`.
 * @pattern Chain of Responsibility — a per-window registry shadows the ancestor's, reusing `createBackInterceptRegistry`.
 * @pattern Controlled Component — React's controlled `open` satisfies the intent; the host's callback is the policy.
 */
import { useState, type FC, type ReactNode } from 'react';

import { BackInterceptContext } from '../backIntercept/backInterceptContext.native.js';
import { createBackInterceptRegistry } from '../backIntercept/backInterceptRegistry.js';
import { Modal, type ModalProps } from '../modal/Modal.native.js';
import { answerWindowBack, type DismissRequest } from './dismissRoute.js';
import { OverlayDismissContext } from './overlayDismissContext.native.js';

/** Props for {@link OverlayHost}: the design-system `Modal`'s, with Back replaced by the dismiss request. */
export interface OverlayHostProps extends Omit<ModalProps, 'onRequestClose' | 'children'> {
    /** The host's dismissal policy, called once per request with the route that raised it. Idempotent. */
    readonly onDismissRequest: DismissRequest;
    readonly children: ReactNode;
}

/**
 * A `Modal` whose every dismissal is one {@link DismissRequest}.
 *
 * @param props - The Modal props and the host's dismissal policy.
 * @returns The Modal, with the window's back scope and dismiss sink published to its children.
 */
export const OverlayHost: FC<OverlayHostProps> = ({ onDismissRequest, children, ...modalProps }) => {
    // Created once per host: the registry's identity is what every descendant registration is held against.
    const [scope] = useState(createBackInterceptRegistry);

    return (
        <Modal {...modalProps} onRequestClose={() => answerWindowBack(scope, onDismissRequest)}>
            <BackInterceptContext.Provider value={scope}>
                <OverlayDismissContext.Provider value={onDismissRequest}>{children}</OverlayDismissContext.Provider>
            </BackInterceptContext.Provider>
        </Modal>
    );
};
