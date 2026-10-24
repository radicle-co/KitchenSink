/**
 * The end of a cook's device session on web: the shared `endDeviceSession` bound to the app's stores. Recent searches live
 * in `localStorage` (owner ruling 2026-10-17, `docs/design/uiOverhaul/ownerDecisions.md`), so the binding must reach it
 * beside the tab's `sessionStorage` store, or a sign-out would leave the history on a shared browser.
 */
import { recentSearchesKeyFor } from '@commise/features-recipes';
import { afterEach, describe, expect, it } from 'vitest';

import { endDeviceSession } from '@/components/recipes/deviceSession';

afterEach(() => window.localStorage.clear());

describe('endDeviceSession (web)', () => {
    it('⛔ removes the cook`s recent searches from localStorage and keeps another cook`s', async () => {
        window.localStorage.setItem(recentSearchesKeyFor('user_a'), JSON.stringify(['soup']));
        window.localStorage.setItem(recentSearchesKeyFor('user_b'), JSON.stringify(['stew']));

        await endDeviceSession('user_a');

        expect(window.localStorage.getItem(recentSearchesKeyFor('user_a'))).toBeNull();
        expect(window.localStorage.getItem(recentSearchesKeyFor('user_b'))).toBe(JSON.stringify(['stew']));
    });
});
