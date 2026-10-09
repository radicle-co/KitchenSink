/**
 * @module lib/searchShortcutPreference — whether the `/` search shortcut is on, per DEVICE
 * (`docs/architecture/uiOverhaulBlueprint.md` A18).
 *
 * WCAG 2.1.4 (Character Key Shortcuts) lets a single-character shortcut stand only if it can be turned off, and
 * Profile › Keyboard shortcuts is that switch. The value is a web-only affordance tied to the keyboard in use and is
 * not personal data, so it lives in this browser's `localStorage` as `prefs.v1.searchShortcut` rather than on the
 * account (an identity-service field for one boolean). ⚠️ It is a third narrow browser-storage use beside D7 and D18
 * in `ownerDecisions.md`; the blueprint sanctions it, no owner ruling names it.
 *
 * The shortcut is ON unless the stored value is exactly `off`: a missing key, a value this code did not write, a
 * server render and a browser with storage disabled all read as on, because the cook never chose otherwise. A write
 * that fails is dropped — a preference that cannot persist is not an error worth surfacing.
 *
 * Shaped for `useSyncExternalStore`: `subscribeToSearchShortcut` tells a listener about a change made in THIS tab (a
 * `storage` event never fires in the tab that wrote) and in any other tab.
 */

/** The `localStorage` key. Versioned (`v1`) so a later shape can coexist. */
export const SEARCH_SHORTCUT_STORAGE_KEY = 'prefs.v1.searchShortcut';

/** The stored value that turns the shortcut off. */
const OFF = 'off';

/** The listeners to tell about a change made in this tab. */
const sameTabListeners = new Set<() => void>();

/** @returns `localStorage`, or `undefined` on the server or when merely touching it throws. */
function storageOrUndefined(): Storage | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

/**
 * @returns Whether the `/` shortcut is on. True unless the cook turned it off on this device.
 * @sideEffect Reads `window.localStorage`.
 */
export function readSearchShortcutEnabled(): boolean {
    try {
        return storageOrUndefined()?.getItem(SEARCH_SHORTCUT_STORAGE_KEY) !== OFF;
    } catch {
        return true;
    }
}

/**
 * Persist the preference and tell this tab's subscribers.
 *
 * @param enabled - Whether the shortcut should be on.
 * @sideEffect Writes `window.localStorage` (silently skipped when that fails) and calls this tab's listeners.
 */
export function writeSearchShortcutEnabled(enabled: boolean): void {
    try {
        const storage = storageOrUndefined();

        if (enabled) {
            storage?.removeItem(SEARCH_SHORTCUT_STORAGE_KEY);
        } else {
            storage?.setItem(SEARCH_SHORTCUT_STORAGE_KEY, OFF);
        }
    } catch {
        // Best-effort: see the module doc.
    }

    sameTabListeners.forEach((listener) => listener());
}

/**
 * Subscribe to changes of the preference, made in this tab or another.
 *
 * @param listener - Called after a change.
 * @returns The unsubscribe function.
 * @sideEffect Adds a `storage` listener on `window` and a same-tab listener.
 */
export function subscribeToSearchShortcut(listener: () => void): () => void {
    const onStorage = (event: StorageEvent): void => {
        // `key` is null when the whole store was cleared.
        if (event.key === null || event.key === SEARCH_SHORTCUT_STORAGE_KEY) {
            listener();
        }
    };

    sameTabListeners.add(listener);
    window.addEventListener('storage', onStorage);

    return () => {
        sameTabListeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}
