/**
 * The web adapter for the recent-search port: `localStorage` behind an async pair that never rejects. `removeItem` is the
 * leg the owner ruling of 2026-10-17 (`docs/design/uiOverhaul/ownerDecisions.md`) adds, so a sign-out can forget a user's
 * history.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { webRecentSearchStore } from '@/lib/recentSearchStore';

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('webRecentSearchStore', () => {
    it('removeItem deletes the key from localStorage and leaves the others', async () => {
        window.localStorage.setItem('k.a', '["soup"]');
        window.localStorage.setItem('k.b', '["stew"]');

        await webRecentSearchStore.removeItem('k.a');

        expect(window.localStorage.getItem('k.a')).toBeNull();
        expect(window.localStorage.getItem('k.b')).toBe('["stew"]');
    });

    it('⛔ removeItem resolves (never rejects) when storage throws', async () => {
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        await expect(webRecentSearchStore.removeItem('k')).resolves.toBeUndefined();
    });

    it('round-trips a value through setItem and getItem', async () => {
        await webRecentSearchStore.setItem('k', 'v');

        expect(await webRecentSearchStore.getItem('k')).toBe('v');
    });
});
