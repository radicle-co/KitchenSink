/**
 * Supported locales for the Commise apps (web + mobile). English is the only SHIPPED locale today; the
 * whole localization machinery (matcher, dictionaries, providers) is locale-count-agnostic, so adding a
 * locale is exactly: add its dictionary entries and list its tag here. Tags are BCP-47 language tags.
 */

/** A BCP-47 language tag the apps may resolve to. A string so the machinery stays N-locale-ready. */
export type Locale = string;

/**
 * The default/fallback locale — every shared dictionary MUST provide this entry. Typed as the literal
 * `'en'` (not widened to `Locale`) so `LocalizedMessages`'s required `en` key resolves to `T`, not
 * `T | undefined`, when indexed by it.
 */
export const DEFAULT_LOCALE = 'en';

/** Locales the running apps actually ship, in preference order (used for tie-breaks). */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en'];

/** Whether `value` is one of the shipped {@link SUPPORTED_LOCALES}. Pure. */
export function isSupportedLocale(value: string): boolean {
    return SUPPORTED_LOCALES.includes(value);
}
