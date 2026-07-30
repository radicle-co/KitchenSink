// Web locale helpers built on the shared `@commise/i18n` core. The app serves the locale in the URL path
// (`/{locale}/…`, Next.js App Router i18n): middleware negotiates + redirects locale-less requests, and
// the `[locale]` segment carries it through the tree. These helpers are pure so the middleware logic is
// unit-testable without a request.
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localesFromAcceptLanguage, matchLocale, type Locale } from '@commise/i18n';

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from '@commise/i18n';
export type { Locale } from '@commise/i18n';

/** The leading path segment when it is a supported locale, else `null`. Pure. */
export function localeFromPathname(pathname: string): Locale | null {
    const segment = pathname.split('/')[1] ?? '';

    return SUPPORTED_LOCALES.includes(segment) ? segment : null;
}

/** Prefix a locale-less pathname with `locale` (root `/` → `/{locale}`). Pure. */
export function withLocalePath(pathname: string, locale: Locale): string {
    return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
}

/** Negotiate the best supported locale from an `Accept-Language` header (falls back to the default). Pure. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
    return matchLocale(localesFromAcceptLanguage(acceptLanguage), SUPPORTED_LOCALES, DEFAULT_LOCALE);
}
