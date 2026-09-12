/**
 * @module @commise/ui/back-intercept — the ONE hardware-back subscription for a navigating surface.
 *
 * A host (a screen that owns a navigation stack) mounts this once and supplies its own back navigation as
 * `onUnhandled`. Any descendant with something to lose installs an interceptor through `useBackIntercept`;
 * the press is offered to those first, most-recently-mounted first, and only reaches `onUnhandled` when every
 * one of them declined.
 *
 * ⛔ **`onUnhandled` IS THE TERMINAL LINK, AND IT IS DELIBERATELY NOT A REGISTRY MEMBER.** A host that
 * registered itself as an ordinary interceptor would have to win a race it cannot control: React runs passive
 * effects child-first, so in the commit where a pushed surface mounts, a host whose effect also re-runs
 * registers AFTER its own child — and RN's LIFO order would then hand the host the press and let it pop the
 * surface out from under an unsaved draft. Keeping the default out of the list removes the race instead of
 * managing it.
 *
 * ⚠️ **An open React Native `Modal` never lets the press reach here at all.** RN's modal host catches
 * `KEYCODE_BACK` on the dialog window and fires `onRequestClose` itself, so no `hardwareBackPress` event is
 * emitted while one is up. That is why this module carries no "suspend interceptors while a dialog is open"
 * machinery — there is nothing to suspend. It also means a guarded surface takes TWO presses to leave: one to
 * raise the confirmation, one that the dialog itself answers.
 *
 * It is an ORCHESTRATION component, not a presentational one: it renders no UI of its own and exists to decide
 * one thing — whether a back press is answered by a mounted surface or falls through to the host.
 *
 * @pattern Adapter over React Native's `BackHandler` — one subscription for the whole surface, translating a
 *     single platform event into a registry dispatch with the host's own navigation as the chain's terminal link.
 */
import { useEffect, useEffectEvent, useState, type FC, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

import { BackInterceptContext } from './backInterceptContext.native.js';
import { createBackInterceptRegistry } from './backInterceptRegistry.js';

/** Props for {@link BackInterceptProvider}. */
export interface BackInterceptProviderProps {
    /**
     * What to do with a press no interceptor consumed — the host's own back navigation.
     *
     * Return `true` when the host handled it, `false` to let the platform default apply (on Android, leaving
     * the app). Its identity may change every render; the subscription does not re-register for it.
     */
    readonly onUnhandled: () => boolean;
    readonly children: ReactNode;
}

/**
 * Mount the hardware-back seam for one navigating surface.
 *
 * @param props - The host's `onUnhandled` default and the subtree it wraps.
 * @returns The subtree, with the registry published to it.
 */
export const BackInterceptProvider: FC<BackInterceptProviderProps> = ({ onUnhandled, children }) => {
    // Created once, for the provider's whole lifetime: the registry's identity is what every descendant's
    // registration is held against, so re-creating it per render would silently drop every interceptor.
    const [registry] = useState(createBackInterceptRegistry);

    // Reads the CURRENT render's `onUnhandled` without making it a dependency of the subscription. This is
    // the documented shape for an Effect Event — declared and consumed inside the same component, called from
    // a listener this component's own effect registered — and it is why neither this module nor the host
    // needs a ref for freshness.
    const fallback = useEffectEvent(() => onUnhandled());

    // ⛔ EMPTY DEPS, AND THAT IS THE POINT. One subscription per mount, registered once and never re-ordered.
    // The previous shape (in `RecipesScreen`) re-registered on every push and pop; that alone is what put the
    // host's handler ahead of its own children's in RN's LIFO list.
    //
    // @sideEffect Subscribes to the platform's hardware-back event for the provider's lifetime.
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => registry.dispatch() || fallback());

        return () => subscription.remove();
    }, [registry]);

    return <BackInterceptContext.Provider value={registry}>{children}</BackInterceptContext.Provider>;
};
