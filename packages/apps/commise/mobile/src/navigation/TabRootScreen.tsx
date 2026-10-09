/**
 * @module navigation/TabRootScreen — a tab's root screen inside its `ScrollHost`, so the second tap on the active tab
 * scrolls it to the top (React Navigation's `useScrollToTop`, over the host's one scroller handle) and the screen's
 * chrome — the condensed title bar, the floating create button — reads one scroll. The iOS status-bar tap reaches the
 * same scroller natively, because it is the screen's only one with `scrollsToTop` (`nativeScrollsToTop` guard).
 *
 * ORCHESTRATION of the tab root's scroll; it draws nothing of its own.
 *
 * @pattern Mediator — composes the library's `useScrollToTop` with the design system's `ScrollHost`
 */
import { useScrollToTop } from '@react-navigation/native';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import type { JSX, ReactNode } from 'react';

/** Hands the host's scroller to React Navigation's tab re-tap. */
function ScrollToTopOnTabPress({ children }: { readonly children: ReactNode }): JSX.Element {
    useScrollToTop(useScrollHost().handle);

    return <>{children}</>;
}

/** Props for {@link TabRootScreen}. */
export interface TabRootScreenProps {
    /** The screen, given the bind for its one vertical scroller. */
    readonly children: (bind: ScrollBind) => ReactNode;
}

/**
 * @param props - The screen as a function of its scroller's bind.
 * @returns The screen inside its scroll host.
 */
export function TabRootScreen({ children }: TabRootScreenProps): JSX.Element {
    return <ScrollHost>{(bind) => <ScrollToTopOnTabPress>{children(bind)}</ScrollToTopOnTabPress>}</ScrollHost>;
}
