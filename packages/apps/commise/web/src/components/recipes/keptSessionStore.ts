'use client';

/**
 * @module @commise/web — the browser's kept cooking-session store (ADR-0094 sections 3 and 6): `localStorage`,
 * not the tab's `sessionStorage`, because the record is shared by every tab of the cook. One tab writes at a time
 * through Web Locks; where they are missing the store keeps the session in memory and writes nothing.
 *
 * Every browser global is resolved at first use, so a server render that imports this touches nothing.
 *
 * @pattern Adapter — `localStorage` and the DOM's three change events behind the store's `KeptPort`.
 */
import { createKeptSessionStore, KEPT_KEY_PREFIX, type KeptPort } from '@commise/features-recipes/session';

import { browserLocks } from '@/components/recipes/browserLocks';
import { reportErrorToSentry } from '@/lib/sentryErrorReporter';

/** The port over `window.localStorage`. A write the browser refuses (quota, private mode) is an outcome, not a throw. */
export const webKeptPort: KeptPort = {
    read: (key) => Promise.resolve(window.localStorage.getItem(key)),
    write: (key, value) => {
        try {
            window.localStorage.setItem(key, value);

            return Promise.resolve({ ok: true });
        } catch (error) {
            return Promise.resolve({ ok: false, error });
        }
    },
    remove: (key) => {
        window.localStorage.removeItem(key);

        return Promise.resolve();
    },
    keys: (prefix) =>
        Promise.resolve(
            Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)).filter(
                (key): key is string => key !== null && key.startsWith(prefix),
            ),
        ),
    subscribeExternal: (onChange) => {
        const onStorage = (event: StorageEvent): void => {
            // `key === null` is `localStorage.clear()` in another tab.
            if (event.key === null || event.key.startsWith(KEPT_KEY_PREFIX)) {
                onChange();
            }
        };

        const onPageShow = (event: PageTransitionEvent): void => {
            if (event.persisted) {
                onChange();
            }
        };

        const onVisibility = (): void => {
            if (document.visibilityState === 'visible') {
                onChange();
            }
        };

        window.addEventListener('storage', onStorage);
        window.addEventListener('pageshow', onPageShow);
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('pageshow', onPageShow);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    },
};

/** The web's one kept store: the tab holds the lock for each write, so a tab cannot overwrite another's work. */
export const webKeptSessionStore = createKeptSessionStore({
    port: webKeptPort,
    // `browserLocks()` is the one presence check (Web Locks needs a secure origin); the waiting `request` is the DOM's.
    exclusiveOf: () => (browserLocks() === undefined ? undefined : (name, work) => navigator.locks.request(name, work)),
    now: () => new Date().toISOString(),
    report: reportErrorToSentry,
    // shortcut: the web app has no logger seam, so a missing Web Locks is a console warning; replace it with the seam when one exists.
    warn: (message) => console.warn(message),
});
