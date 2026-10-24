import { DEFAULT_LOCALE, SUPPORTED_LOCALES, matchLocale, type Locale } from '@commise/i18n';

/**
 * Resolve the app locale from the device's ORDERED preferred language tags (from expo-localization's
 * `getLocales()` / `useLocales()`), matching against the shipped locales and falling back to the default.
 * Pure — the impure device read + re-render live in `LocaleProvider`.
 *
 * @param languageTags - BCP-47 tags, most-preferred first (`Localization.getLocales().map(l => l.languageTag)`).
 */
export function resolveDeviceLocale(languageTags: readonly string[]): Locale {
    return matchLocale(languageTags, SUPPORTED_LOCALES, DEFAULT_LOCALE);
}
