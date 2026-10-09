'use client';

/**
 * @module @commise/features-recipes — `CookMarksProvider`, an orchestration component: the session's cook-marks store, mounted once in each app's
 * composition root beside `useQuerySessionScope` (ADR-0054), and given the signed-in cook.
 *
 * It builds ONE store over the platform's backend (`sessionStorage` on web, memory on native) and applies the session
 * scope whenever the cook changes: marks are kept for the cook who made them and removed at the end of their session.
 *
 * @pattern Ports & Adapters — the composition root that picks the platform's backend for the store's port
 */
import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';

import { defaultCookMarksBackend } from './cookMarksBackend.js';
import { CookMarksContext } from './cookMarksContext.js';
import { createCookMarksStore, type CookMarksBackend } from './cookMarksStore.js';

/** Props for {@link CookMarksProvider}. */
export interface CookMarksProviderProps {
    /** The signed-in cook's id (Clerk `userId`), or `undefined` while nobody is signed in or the session is loading. */
    readonly subject: string | undefined;
    /** Where marks are kept; the platform's default when absent. A test seam. */
    readonly backend?: CookMarksBackend;
    readonly children: ReactNode;
}

/** The session's cook-marks store, scoped to the signed-in cook. */
export const CookMarksProvider: FC<CookMarksProviderProps> = ({ subject, backend, children }) => {
    const [store] = useState(() => createCookMarksStore(backend ?? defaultCookMarksBackend()));
    const scope = useMemo(() => ({ store, subject }), [store, subject]);

    useEffect(() => {
        store.scope(subject);
    }, [store, subject]);

    return <CookMarksContext.Provider value={scope}>{children}</CookMarksContext.Provider>;
};
