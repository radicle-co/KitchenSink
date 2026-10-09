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

/**
 * The pseudo-locale (`en-XA`, the CLDR private-use tag for pseudo-English): English, accented and grown by 35%, so a
 * layout that only fits English shows it (`./pseudo.ts`). It is deliberately NOT in {@link SUPPORTED_LOCALES} — that
 * list is mobile's too. The web app routes it only in a build made with `COMMISE_PSEUDO_LOCALE=1`.
 */
export const PSEUDO_LOCALE: Locale = 'en-XA';
