/**
 * @module @commise/ui/back-intercept — the membership + dispatch half of the hardware-back seam, with NO
 * React and NO React Native in it.
 *
 * It exists as its own pure module for a reason that is about testability, not tidiness. `react-native-web`'s
 * `BackHandler.addEventListener` is an inert stub that logs and hands back a no-op subscription, so anything
 * written directly against `BackHandler` is structurally unreachable from the vitest tier — which is exactly
 * how the defect this seam fixes shipped with no test able to see it. Splitting "which handlers, in what
 * order" (here, pure) from "the one platform subscription" (the provider, one thin adapter) is what makes
 * the behaviour assertable at all.
 *
 * **Ordering is the contract, not an implementation detail.** A pushed surface mounts AFTER the host that
 * renders it, so offering the press most-recently-registered first is what lets the recipe editor veto a back
 * press the navigator would otherwise answer by popping the surface out from under an unsaved draft.
 *
 * ⛔ **The host's own default is NOT a member of this list.** The provider supplies it as the terminal step
 * after `dispatch` declines. Keeping it out is what stops dispatch order from being load-bearing: with zero
 * or one interceptors registered there is no ordering question at all, and a host that registered itself as
 * a member would have to win or lose a race against every surface it hosts.
 *
 * @pattern Registry — the one authoritative registration point for back interceptors; `register` hands back its
 *     own removal, so an entry cannot outlive the component that installed it.
 * @pattern Chain of Responsibility — `dispatch` offers one press along the chain, most recent link first, and
 *     stops at the first link that consumes it.
 */

/**
 * A back-press interceptor.
 *
 * ⛔ Return `true` when you took the press — INCLUDING when you answered it by navigating yourself. Returning
 * `false` after navigating lets the host's default run as well, and TWO surfaces are lost instead of one.
 */
export type BackInterceptHandler = () => boolean;

/** The registration + dispatch surface a {@link createBackInterceptRegistry} hands out. */
export interface BackInterceptRegistry {
    /**
     * Register `handler` as the newest link in the chain.
     *
     * Registering the same handler twice holds it once. The returned function removes it and is safe to call
     * more than once.
     */
    readonly register: (handler: BackInterceptHandler) => () => void;
    /**
     * Offer one back press to the chain, most-recently-registered first.
     *
     * @returns `true` once a link consumes the press; `false` when every link declined (or none is registered),
     *   which is the host's cue to apply its own default.
     */
    readonly dispatch: () => boolean;
}

/**
 * Create an empty back-interceptor registry.
 *
 * @returns Its {@link BackInterceptRegistry} surface.
 * @sideEffect Closes over mutable membership — each call yields an independent registry.
 */
export function createBackInterceptRegistry(): BackInterceptRegistry {
    const handlers: BackInterceptHandler[] = [];

    const remove = (handler: BackInterceptHandler): void => {
        const index = handlers.indexOf(handler);

        if (index >= 0) {
            handlers.splice(index, 1);
        }
    };

    return {
        register: (handler) => {
            if (!handlers.includes(handler)) {
                handlers.push(handler);
            }

            return () => remove(handler);
        },
        // Walks a SNAPSHOT on purpose: a handler is allowed to unregister itself or a sibling while it runs
        // (a surface that answers the press by unmounting does exactly that), and mutating the live array
        // mid-walk would shift the index under the loop and silently skip the next link.
        dispatch: () => {
            const snapshot = [...handlers].reverse();

            for (const handler of snapshot) {
                if (handler()) {
                    return true;
                }
            }

            return false;
        },
    };
}
