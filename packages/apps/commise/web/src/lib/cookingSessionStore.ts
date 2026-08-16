/**
 * The WEB adapter for `@kitchensink/cooking-core`'s `CookingSessionStore` port — Cooking Mode's 24h
 * resume window (FR-033 / REQ-013) over `window.localStorage`.
 *
 * **Why `localStorage` and not IndexedDB.** A persisted session is one small JSON envelope per recipe,
 * written on each step/timer/checkoff transition and read once when Cooking Mode opens. That is exactly
 * the key/value shape `localStorage` exists for, and it is the substrate the app's other device-storage
 * port (`recentSearchStore`) already uses — a second, heavier storage stack for the same access pattern
 * would be more machinery for no capability. IndexedDB earns its complexity when payloads are large or
 * queried; neither is true here. (The port's own docstring names IndexedDB as the expected web backing;
 * the port deliberately leaves that choice to the adapter, and this is the choice recorded.)
 *
 * **A storage failure is NOT "there is no session".** The port is explicit: `read` returning `null`
 * means the device holds nothing, while a REJECTION means the storage layer failed — and
 * `useCookingSession` distinguishes them (it starts a fresh session on failure, deliberately, so a
 * broken device costs the cook their place and never the recipe). Degrading a thrown `localStorage`
 * into `null` would erase that distinction, so every failure here surfaces as a rejection instead.
 *
 * Module-level singleton on purpose: the store's identity is a `useEffect` dependency inside
 * `useCookingSession`, so a fresh object per render would restart the restore/persist effects on every
 * frame — the hook's own contract requires referential stability.
 */
import type { CookingSessionStore } from '@kitchensink/cooking-core';

/**
 * Namespace for every persisted cooking session. One entry per recipe, so two recipes cooked in the
 * same browser cannot overwrite each other's progress.
 */
export const COOKING_SESSION_KEY_PREFIX = 'commise:cooking-session:';

/**
 * Raised when the browser refuses to hand over `localStorage` at all — storage disabled by policy,
 * Safari private mode, or a server render (where the global does not exist).
 *
 * A distinct type rather than a bare `Error` so a caller can tell "the device is unusable" from a
 * genuine read/write fault (a quota rejection, say) without string-matching a message.
 */
export class CookingSessionStorageUnavailableError extends Error {
    /**
     * @param cause - The underlying access failure, when there was one.
     */
    constructor(cause?: unknown) {
        super('Local storage is unavailable, so the cooking session cannot be read or written.');
        this.name = 'CookingSessionStorageUnavailableError';
        Object.setPrototypeOf(this, CookingSessionStorageUnavailableError.prototype);

        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

/**
 * Type guard for {@link CookingSessionStorageUnavailableError}.
 *
 * @param error - The value to test.
 * @returns `true` when `error` is a {@link CookingSessionStorageUnavailableError}.
 */
export function isCookingSessionStorageUnavailableError(
    error: unknown,
): error is CookingSessionStorageUnavailableError {
    return error instanceof CookingSessionStorageUnavailableError;
}

/**
 * The browser's `localStorage`.
 *
 * @returns The live `Storage` object.
 * @throws {CookingSessionStorageUnavailableError} On a server render, or when the property access itself
 *   throws (storage disabled / private mode — it throws on ACCESS, not on some later call).
 * @sideEffect Reads `window.localStorage`.
 */
function requireLocalStorage(): Storage {
    if (typeof window === 'undefined') {
        throw new CookingSessionStorageUnavailableError();
    }

    try {
        return window.localStorage;
    } catch (error: unknown) {
        throw new CookingSessionStorageUnavailableError(error);
    }
}

/**
 * The storage key for one recipe's session. Pure.
 *
 * @param recipeId - The recipe being cooked.
 * @returns The namespaced `localStorage` key.
 */
function keyFor(recipeId: string): string {
    return `${COOKING_SESSION_KEY_PREFIX}${recipeId}`;
}

/** The `localStorage`-backed cooking-session store for the web app. */
export const webCookingSessionStore: CookingSessionStore = {
    /**
     * Read the serialized session for a recipe.
     *
     * @param recipeId - Recipe whose session to read.
     * @returns The stored payload, or `null` when the device holds none for this recipe.
     * @throws {CookingSessionStorageUnavailableError} When storage cannot be reached at all.
     * @sideEffect Reads `window.localStorage`.
     */
    read: async (recipeId: string): Promise<string | null> => requireLocalStorage().getItem(keyFor(recipeId)),

    /**
     * Persist the serialized session for a recipe, replacing any previous entry.
     *
     * @param recipeId - Recipe whose session to write.
     * @param serialized - The payload produced by `serializeSession`.
     * @throws {CookingSessionStorageUnavailableError} When storage cannot be reached at all. A quota
     *   failure propagates as the browser's own error — the caller must not mistake it for a stored session.
     * @sideEffect Writes `window.localStorage`.
     */
    write: async (recipeId: string, serialized: string): Promise<void> => {
        requireLocalStorage().setItem(keyFor(recipeId), serialized);
    },

    /**
     * Remove any stored session for a recipe. Removing an absent key is not an error.
     *
     * @param recipeId - Recipe whose session to remove.
     * @throws {CookingSessionStorageUnavailableError} When storage cannot be reached at all.
     * @sideEffect Writes `window.localStorage`.
     */
    remove: async (recipeId: string): Promise<void> => {
        requireLocalStorage().removeItem(keyFor(recipeId));
    },
};
