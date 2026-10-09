/**
 * @module home/chrome/sidebarPreference — the sidebar's collapse preference, "per device" (`buildSpec.md` §3.2), held
 * in a cookie the locale layout reads on the server, so SSR renders the right width with no hydration mismatch and no
 * layout shift. Not personal data and not app data: one word about the chrome.
 */

/** The cookie's name. */
export const SIDEBAR_COOKIE = 'commise.sidebar';

/**
 * @param value - The cookie's value, if it is set.
 * @returns Whether the sidebar is collapsed. Absent or unknown is expanded, the default. Pure.
 */
export function sidebarCollapsedFrom(value: string | undefined): boolean {
    return value === 'collapsed';
}

/**
 * @param collapsed - The new preference.
 * @returns The `document.cookie` assignment that stores it for a year, site-wide. Pure.
 */
export function sidebarCookieFor(collapsed: boolean): string {
    return `${SIDEBAR_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
}
