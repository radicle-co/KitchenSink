'use client';

/**
 * @module home/chrome/sidebarPreferenceContext — the sidebar's collapse preference for the whole document: seeded from
 * the cookie the locale layout read on the server (`sidebarPreference.ts`), so the first render — server and client
 * alike — draws the right width, and held HERE, above every page, so a re-mounted shell (a route change, a server
 * refresh) keeps the cook's choice instead of re-reading a stale seed. A toggle writes the cookie back for the next
 * request.
 *
 * ORCHESTRATION: it owns the preference and its one side effect, the cookie; it draws nothing.
 *
 * @pattern Context Provider — the one owner of a document-wide view preference, seeded server-side
 */
import { createContext, useContext, useMemo, useState, type FC, type ReactNode } from 'react';

import { sidebarCookieFor } from './sidebarPreference';

/** The preference and its toggle. */
export interface SidebarPreference {
    readonly collapsed: boolean;
    readonly toggle: () => void;
}

const SidebarPreferenceContext = createContext<SidebarPreference>({ collapsed: false, toggle: () => undefined });

/** Provides the preference, seeded from the server-read cookie. */
export const SidebarPreferenceProvider: FC<{ readonly collapsed: boolean; readonly children: ReactNode }> = ({
    collapsed: seed,
    children,
}) => {
    const [collapsed, setCollapsed] = useState(seed);
    const value = useMemo<SidebarPreference>(
        () => ({
            collapsed,
            toggle: () => {
                const next = !collapsed;
                setCollapsed(next);
                // @sideEffect The preference is per device, read back by the server on the next request.
                document.cookie = sidebarCookieFor(next);
            },
        }),
        [collapsed],
    );

    return <SidebarPreferenceContext.Provider value={value}>{children}</SidebarPreferenceContext.Provider>;
};

/** The sidebar's collapse preference and its toggle. */
export function useSidebarPreference(): SidebarPreference {
    return useContext(SidebarPreferenceContext);
}
