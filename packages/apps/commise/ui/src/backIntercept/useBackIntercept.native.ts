/**
 * @module @commise/ui/back-intercept — install a hardware-back interceptor for as long as a component is
 * mounted.
 *
 * This is how a surface with unsaved work says "not yet" to the system back button. It is the SAME answer the
 * surface's own back control gives — one guard, two entry points — which is the whole point: the defect this
 * seam fixes was a screen whose header arrow asked before discarding and whose system back button did not.
 *
 * ⛔ **THE CONTRACT: return `true` when you took the press, INCLUDING when you answered it by navigating
 * yourself.** Returning `false` after navigating lets the host's own default run as well, and two surfaces are
 * popped instead of one.
 *
 * ⛔ **THE REF IS THE POINT, and it is the sanctioned kind.** Registration identity must be STABLE (so a link's
 * position in the chain is its mount order, not its last render) while the function it calls must be the
 * CURRENT render's. A handler captured at mount closes over the mount-time state — for the recipe wizard that
 * is `isDirty === false` forever, so back would discard the cook's work behind a suite that only ever pressed
 * back on a clean form. The ref holds nothing render-affecting: it is a latest-callback latch, written in an
 * effect (never in the render body, the hazard `useRecipeEditor`'s `submitDraftRef` was rewritten for) and
 * read only from the registry's dispatch.
 *
 * ⚠️ `useEffectEvent` is deliberately NOT used for this one, and that is not an oversight. React documents an
 * Effect Event as non-transferable — it must not be passed out of the component that declares it — and this
 * wrapper is handed to a registry owned by an ANCESTOR. It happens to work today; betting a data-loss guard on
 * unspecified behaviour is not a trade worth making. The provider's own `useEffectEvent` is the legal case:
 * declared and consumed inside one component.
 *
 * @pattern Chain of Responsibility — one link in the back-press chain, registered for the component's lifetime;
 *     the ref beneath it is a latest-handler latch, not held state.
 */
import { useContext, useEffect, useRef } from 'react';

import { BackInterceptContext } from './backInterceptContext.native.js';
import type { BackInterceptHandler } from './backInterceptRegistry.js';

/**
 * Intercept the hardware back press while the calling component is mounted.
 *
 * @param handler - Called on a back press. Return `true` to consume it (see the module doc's contract).
 * @throws When no `BackInterceptProvider` is mounted above — a missing back guard must be loud, never silent.
 * @sideEffect Registers with the ancestor registry for the component's lifetime.
 */
export function useBackIntercept(handler: BackInterceptHandler): void {
    const registry = useContext(BackInterceptContext);
    const latest = useRef(handler);

    // Written in an effect, not the render body: a render React discards never commits, so it must not be
    // allowed to advance the latch and leave the committed tree answering through a closure that was thrown
    // away.
    useEffect(() => {
        latest.current = handler;
    });

    if (registry === null) {
        throw new Error('useBackIntercept must be used inside a <BackInterceptProvider>.');
    }

    // Registers ONCE per mount. The indirection through `latest` is what lets that be true while the handler
    // it calls stays current — see the module doc.
    useEffect(() => registry.register(() => latest.current()), [registry]);
}
