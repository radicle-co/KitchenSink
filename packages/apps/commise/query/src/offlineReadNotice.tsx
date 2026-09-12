/**
 * @module @commise/query — the seam through which an app supplies its own offline-read copy.
 *
 * The boundary decides WHEN to show an offline notice; the composition root decides WHAT it says. That split
 * is why this exists: `@commise/query` has no dictionary and no platform leaves, and the design system's own
 * rule is that it "carries no copy of its own" — so neither layer can hold the string.
 *
 * ⛔ THE DEFAULT IS IDENTITY, AND THAT IS THE COMPATIBILITY GUARANTEE. A tree with no provider renders exactly
 * what it rendered before this module existed. So the failure mode of mounting the provider in the wrong
 * place is the OLD behaviour returning — a skeleton — never a crash and never an empty slot.
 *
 * ⚠️ Which is also why the provider is mounted immediately inside `QueryClientProvider` in both apps rather
 * than anywhere convenient: a silent default cannot report a boundary that escaped it, so the guarantee has
 * to be structural. "Has a query client" ⇒ "has offline copy", and a boundary outside the client provider
 * already throws for the missing client.
 *
 * @pattern Strategy supplied by ambient context, with a Null Object default — the composition root injects the
 *     renderer; the boundary never learns the copy or the platform.
 */
import { createContext, useContext, type FC, type ReactNode } from 'react';

/** Wraps the pending node when a read is parked offline. Returns it unchanged to render the skeleton. */
export type RenderOffline = (loading: ReactNode) => ReactNode;

/** The Null Object: no provider ⇒ the pending node passes through untouched. */
const identity: RenderOffline = (loading) => loading;

const OfflineReadNoticeContext = createContext<RenderOffline>(identity);

/** Props for {@link OfflineReadNoticeProvider}. */
export interface OfflineReadNoticeProviderProps {
    /** Supplies the app's own localized offline node, given the pending node it replaces. */
    readonly renderOffline: RenderOffline;
    readonly children: ReactNode;
}

/** Supply the offline-read renderer to every `QueryBoundary` beneath. */
export const OfflineReadNoticeProvider: FC<OfflineReadNoticeProviderProps> = ({ renderOffline, children }) => (
    <OfflineReadNoticeContext.Provider value={renderOffline}>{children}</OfflineReadNoticeContext.Provider>
);

/**
 * The ambient offline-read renderer.
 *
 * @returns The provided renderer, or the identity Null Object when no provider is mounted.
 */
export function useRenderOffline(): RenderOffline {
    return useContext(OfflineReadNoticeContext);
}
