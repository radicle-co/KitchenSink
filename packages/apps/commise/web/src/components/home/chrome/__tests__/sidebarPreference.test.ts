/**
 * The sidebar's collapse preference (`buildSpec.md` §3.2: "persists per device"), kept in a cookie so the server
 * renders the right width — no hydration mismatch, no layout shift.
 */
import { describe, expect, it } from 'vitest';

import { SIDEBAR_COOKIE, sidebarCollapsedFrom, sidebarCookieFor } from '../sidebarPreference';

describe('sidebar preference', () => {
    it('is collapsed only when the cookie says exactly so', () => {
        expect(sidebarCollapsedFrom('collapsed')).toBe(true);
        expect(sidebarCollapsedFrom('expanded')).toBe(false);
        expect(sidebarCollapsedFrom(undefined)).toBe(false);
        expect(sidebarCollapsedFrom('COLLAPSED')).toBe(false);
    });

    it('writes a site-wide, year-long, lax cookie the server can read back', () => {
        const cookie = sidebarCookieFor(true);

        expect(cookie.startsWith(`${SIDEBAR_COOKIE}=collapsed;`)).toBe(true);
        expect(cookie).toContain('path=/');
        expect(cookie).toContain('max-age=31536000');
        expect(cookie).toContain('samesite=lax');
        expect(sidebarCookieFor(false).startsWith(`${SIDEBAR_COOKIE}=expanded;`)).toBe(true);
    });

    it('round-trips', () => {
        for (const collapsed of [true, false]) {
            const value = sidebarCookieFor(collapsed).split(';')[0]?.split('=')[1];

            expect(sidebarCollapsedFrom(value)).toBe(collapsed);
        }
    });
});
