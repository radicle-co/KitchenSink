// @vitest-environment jsdom
/**
 * Unit tests for the WEB `CookingSessionStore` adapter (feature 008 / T-011).
 *
 * The port's contract is the thing under test, and its sharpest clause is the one that is easy to get
 * wrong: **a storage failure is NOT "there is no session"**. `restoreSession` treats `null` as
 * "nothing to resume" and a REJECTION as "the device failed", and `useCookingSession` reacts
 * differently to each. An adapter that swallowed a broken `localStorage` into `null` would report a
 * phantom "no session" forever, so the rejection paths below are the real assertions here — not
 * defensive extras.
 *
 * Keys are asserted through the store's own round trip AND through the raw `localStorage` key, because
 * the namespace is what keeps one recipe's session from overwriting another's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COOKING_SESSION_KEY_PREFIX,
    isCookingSessionStorageUnavailableError,
    webCookingSessionStore,
} from '../cookingSessionStore';

/** Replace `window.localStorage` for one test, restoring the real one afterwards. */
function stubLocalStorage(value: unknown): void {
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(value as Storage);
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('webCookingSessionStore', () => {
    it('round-trips a session payload under a recipe-namespaced key', async () => {
        await webCookingSessionStore.write('rec_1', '{"payload":1}');

        await expect(webCookingSessionStore.read('rec_1')).resolves.toBe('{"payload":1}');
        expect(window.localStorage.getItem(`${COOKING_SESSION_KEY_PREFIX}rec_1`)).toBe('{"payload":1}');
    });

    it('keeps each recipe’s session separate', async () => {
        await webCookingSessionStore.write('rec_1', 'one');
        await webCookingSessionStore.write('rec_2', 'two');

        await expect(webCookingSessionStore.read('rec_1')).resolves.toBe('one');
        await expect(webCookingSessionStore.read('rec_2')).resolves.toBe('two');
    });

    it('reports NULL — not a failure — when the device holds no session for the recipe', async () => {
        await expect(webCookingSessionStore.read('rec_absent')).resolves.toBeNull();
    });

    it('replaces a previous entry on write', async () => {
        await webCookingSessionStore.write('rec_1', 'first');
        await webCookingSessionStore.write('rec_1', 'second');

        await expect(webCookingSessionStore.read('rec_1')).resolves.toBe('second');
    });

    it('removes a stored session, and removing an absent one is not an error', async () => {
        await webCookingSessionStore.write('rec_1', 'one');
        await webCookingSessionStore.remove('rec_1');

        await expect(webCookingSessionStore.read('rec_1')).resolves.toBeNull();
        await expect(webCookingSessionStore.remove('rec_1')).resolves.toBeUndefined();
    });

    it('REJECTS rather than reporting an empty device when storage is unavailable', async () => {
        // Safari private mode / storage disabled: the property access itself throws.
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        await expect(webCookingSessionStore.read('rec_1')).rejects.toSatisfy(isCookingSessionStorageUnavailableError);
        await expect(webCookingSessionStore.write('rec_1', 'one')).rejects.toSatisfy(
            isCookingSessionStorageUnavailableError,
        );
        await expect(webCookingSessionStore.remove('rec_1')).rejects.toSatisfy(isCookingSessionStorageUnavailableError);
    });

    it('surfaces a quota failure on write instead of silently dropping the session', async () => {
        const quota = new Error('QuotaExceededError');
        stubLocalStorage({
            getItem: () => null,
            setItem: () => {
                throw quota;
            },
            removeItem: () => undefined,
        });

        await expect(webCookingSessionStore.write('rec_1', 'one')).rejects.toBe(quota);
    });
});

describe('isCookingSessionStorageUnavailableError', () => {
    it('rejects unrelated errors and non-errors', () => {
        expect(isCookingSessionStorageUnavailableError(new Error('nope'))).toBe(false);
        expect(isCookingSessionStorageUnavailableError('nope')).toBe(false);
        expect(isCookingSessionStorageUnavailableError(undefined)).toBe(false);
    });
});
