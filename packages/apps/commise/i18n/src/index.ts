/**
 * `@commise/i18n` — the platform-neutral localization core shared by web and mobile.
 *
 * Locale config + negotiation + the dictionary seam. Framework-free (no React) so Next.js server
 * components and RN can both use it; the React provider/hooks live in the separate `./react` entry.
 */
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './locales.js';
export type { Locale } from './locales.js';
export { matchLocale, localesFromAcceptLanguage } from './matcher.js';
export { resolveMessages } from './dictionary.js';
export type { LocalizedMessages } from './dictionary.js';
