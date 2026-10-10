// Web locale helpers built on the shared `@commise/i18n` core. The app serves the locale in the URL path
// (`/{locale}/…`, Next.js App Router i18n): middleware negotiates + redirects locale-less requests, and
// the `[locale]` segment carries it through the tree. These helpers are pure so the middleware logic is
// unit-testable without a request.
import {
    DEFAULT_LOCALE,
    PSEUDO_LOCALE,
    SUPPORTED_LOCALES,
    localesFromAcceptLanguage,
    matchLocale,
    type Locale,
} from '@commise/i18n';

export { DEFAULT_LOCALE } from '@commise/i18n';
export type { Locale } from '@commise/i18n';

/**
 * The locales this web build routes: the shipped ones, plus the `en-XA` pseudo-locale when the build flag is exactly
 * `'1'`. The shared `SUPPORTED_LOCALES` is mobile's too, so the pseudo-locale is added here and never there. Pure.
 *
 * @param flag - The inlined `COMMISE_PSEUDO_LOCALE`.
 * @returns The routable locales.
 */
export function routableLocales(flag: string | undefined): readonly Locale[] {
    return flag === '1' ? [...SUPPORTED_LOCALES, PSEUDO_LOCALE] : SUPPORTED_LOCALES;
}

/**
 * This build's routable locales. ⛔ BUILD-GATED: `next.config.ts` inlines `COMMISE_PSEUDO_LOCALE` (server, edge
 * middleware and browser alike), so a build made without it cannot route `/en-XA` whatever its runtime environment says.
 */
export const ROUTABLE_LOCALES: readonly Locale[] = routableLocales(process.env['COMMISE_PSEUDO_LOCALE']);

/** Whether `value` is a locale this build routes. Pure. */
export function isRoutableLocale(value: string): boolean {
    return ROUTABLE_LOCALES.includes(value);
}

/** The leading path segment when it is a locale this build routes, else `null`. Pure. */
export function localeFromPathname(pathname: string): Locale | null {
    const segment = pathname.split('/')[1] ?? '';

    return isRoutableLocale(segment) ? segment : null;
}

/** Prefix a locale-less pathname with `locale` (root `/` → `/{locale}`). Pure. */
export function withLocalePath(pathname: string, locale: Locale): string {
    return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
}

/** Negotiate the best supported locale from an `Accept-Language` header (falls back to the default). Pure. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
    return matchLocale(localesFromAcceptLanguage(acceptLanguage), ROUTABLE_LOCALES, DEFAULT_LOCALE);
}
