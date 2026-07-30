import type { Page } from '@playwright/test';

/**
 * The basePath the e2e suite runs under. Since the ADR-0001 subdomain cutover, previews serve at the
 * ROOT (empty basePath) with the locale in the path, so this DEFAULTS to '' (the live/production shape).
 * The legacy per-PR basePath double-prefix bug class is retired with path routing; set E2E_BASE_PATH to a
 * prefix only when pointing at a legacy path-routed preview.
 */
export const BASE_PATH = process.env['E2E_BASE_PATH'] ?? '';

/** The locale segment the app serves under (`/{locale}/…`, Next.js i18n). */
export const LOCALE = process.env['E2E_LOCALE'] ?? 'en';

/** Prefix an app path with the basePath + locale. `route('/sign-in')` → `/en/sign-in`. */
export function route(path: string): string {
    if (path === '/') {
        return `${BASE_PATH}/${LOCALE}`;
    }

    const suffix = path.startsWith('/') ? path : `/${path}`;

    return `${BASE_PATH}/${LOCALE}${suffix}`;
}

/** True when `pathname` is the app home (`/{locale}` or `/{locale}/`). */
export function isHome(pathname: string): boolean {
    const home = route('/');

    return pathname === home || pathname === `${home}/`;
}

/** True when `pathname` is the given app path under the basePath + locale, prefixed exactly ONCE. */
export function isRoute(pathname: string, path: string): boolean {
    const expected = route(path);

    return pathname === expected || pathname === `${expected}/`;
}

/**
 * The double-prefix smell: the basePath OR the locale segment appearing twice in a row
 * (`/pr-e2e/pr-e2e/…` or `/en/en/…`) — the signature of a URL prop that was manually prefixed AND then
 * run through Next's prefix-aware router. Assert against it wherever a redirect/navigation happens.
 */
export function hasDoublePrefix(pathname: string): boolean {
    if (BASE_PATH && pathname.includes(`${BASE_PATH}${BASE_PATH}`)) {
        return true;
    }

    return pathname.includes(`/${LOCALE}/${LOCALE}/`) || pathname.endsWith(`/${LOCALE}/${LOCALE}`);
}

/** Read the current URL pathname from the page. */
export function pathnameOf(page: Page): string {
    return new URL(page.url()).pathname;
}
