/**
 * @module @commise/ui/keep-awake — the web Screen Wake Lock adapter (`docs/architecture/uiOverhaulBlueprint.md` A20,
 * `docs/design/uiOverhaul/buildSpec.md` §6.3).
 *
 * The capability is a secure context AND the API on `navigator`: an older browser or an `http:` page has neither, and
 * the toggle then does not render. `localhost` and the HTTPS previews are secure contexts.
 *
 * The browser drops a screen lock whenever the page is hidden, so a hold asks again each time the page comes back into
 * view. The lock is held in the hold's own closure — not in a ref — and its release lets go of it, including a lock
 * granted after the release: that one would otherwise keep the screen on with nobody left to release it.
 *
 * A refused request (a battery saver, a page that lost visibility mid-request) is not an error the cook can act on, so
 * it is swallowed and the next return to view asks again.
 *
 * @pattern Adapter over the Screen Wake Lock API
 */

/** The part of a `WakeLockSentinel` the adapter reads. */
export interface WakeLockSentinelLike {
    /** Whether the browser (or a release) has let the lock go. */
    readonly released: boolean;
    readonly release: () => Promise<void>;
}

/** What the adapter reads from the page: the window's secure-context flag, `navigator` and `document`. */
export interface WakeLockEnvironment {
    readonly isSecureContext: boolean;
    readonly navigator: {
        readonly wakeLock?: { readonly request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    readonly document: {
        readonly visibilityState: DocumentVisibilityState;
        readonly addEventListener: (type: 'visibilitychange', listener: () => void) => void;
        readonly removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
    };
}

/**
 * Whether this page can hold a screen wake lock. Pure.
 *
 * @param env - The page.
 * @returns `true` in a secure context whose `navigator` has the API.
 */
export function canHoldWakeLock(env: WakeLockEnvironment): boolean {
    return env.isSecureContext && env.navigator.wakeLock !== undefined;
}

/**
 * Hold the screen awake until the returned release is called.
 *
 * @param env - The page.
 * @returns The release. Calling it lets go of the lock and stops listening; it is safe to call more than once.
 * @sideEffect Requests a screen wake lock and listens for `visibilitychange` on the document.
 */
export function holdScreenWakeLock(env: WakeLockEnvironment): () => void {
    const api = env.navigator.wakeLock;

    if (!env.isSecureContext || api === undefined) {
        return () => undefined;
    }

    let held: WakeLockSentinelLike | undefined;
    let pending = false;
    let released = false;

    const acquire = (): void => {
        const stillHeld = held !== undefined && !held.released;

        if (released || pending || stillHeld || env.document.visibilityState !== 'visible') {
            return;
        }

        pending = true;
        api.request('screen').then(
            (granted) => {
                pending = false;

                if (released) {
                    void granted.release().catch(() => undefined);
                } else {
                    held = granted;
                }
            },
            () => {
                pending = false;
            },
        );
    };

    env.document.addEventListener('visibilitychange', acquire);
    acquire();

    return () => {
        if (released) {
            return;
        }

        released = true;
        env.document.removeEventListener('visibilitychange', acquire);

        if (held !== undefined && !held.released) {
            void held.release().catch(() => undefined);
        }

        held = undefined;
    };
}

/**
 * The running page as the adapter reads it, or `undefined` outside a browser (the server render). Reads globals.
 *
 * @returns The page's environment, or `undefined` when there is no window.
 */
export function browserWakeLockEnvironment(): WakeLockEnvironment | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    // The DOM library types `navigator.wakeLock` as always present; an older browser has none, so ask at run time.
    return {
        isSecureContext: window.isSecureContext,
        navigator: 'wakeLock' in navigator ? { wakeLock: navigator.wakeLock } : {},
        document,
    };
}
