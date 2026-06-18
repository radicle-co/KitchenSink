import type { Page } from '@playwright/test';

/**
 * The basePath the e2e suite runs under. Must match the dev server's `PREVIEW_BASE_PATH`
 * (see playwright.config.ts). Defaults to a stand-in preview prefix so the preview-only
 * double-prefix bug class is exercised by default; set E2E_BASE_PATH='' for the production shape.
 */
export const BASE_PATH = process.env['E2E_BASE_PATH'] ?? '/pr-e2e';

/** Prefix an app path with the active basePath. `route('/sign-in')` → `/pr-e2e/sign-in`. */
export function route(path: string): string {
    const suffix = path.startsWith('/') ? path : `/${path}`;

    return `${BASE_PATH}${suffix}`;
}

/** True when `pathname` is the app home under the basePath (`/pr-e2e` or `/pr-e2e/`). */
export function isHome(pathname: string): boolean {
    return pathname === BASE_PATH || pathname === `${BASE_PATH}/`;
}

/** True when `pathname` is the given app path under the basePath, prefixed exactly ONCE. */
export function isRoute(pathname: string, path: string): boolean {
    const expected = route(path);

    return pathname === expected || pathname === `${expected}/`;
}

/**
 * The double-prefix smell: any path containing the basePath twice in a row (`/pr-e2e/pr-e2e/…`).
 * This is the signature of a Clerk URL prop that was manually basePath-prefixed AND then run through
 * Next's basePath-aware router. Assert against it everywhere a redirect/navigation happens.
 */
export function hasDoublePrefix(pathname: string): boolean {
    if (!BASE_PATH) {
        return false;
    }

    return pathname.includes(`${BASE_PATH}${BASE_PATH}`);
}

/** Read the current URL pathname from the page. */
export function pathnameOf(page: Page): string {
    return new URL(page.url()).pathname;
}
