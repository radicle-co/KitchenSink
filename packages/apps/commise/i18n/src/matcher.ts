import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './locales.js';

/**
 * Pick the best available locale for a caller's requested tags (browser/device preference order), using
 * BCP-47 lookup (exact, then language-subtag) via `@formatjs/intl-localematcher` — the matcher the Next.js
 * i18n guide recommends. Falls back to `fallback` when nothing matches or a requested tag is malformed
 * (the matcher throws `RangeError` on invalid tags; we swallow it). Pure.
 *
 * @param requested - Requested language tags, most-preferred first.
 * @param available - Locales to choose from (defaults to {@link SUPPORTED_LOCALES}).
 * @param fallback - Returned when nothing matches (defaults to {@link DEFAULT_LOCALE}).
 */
export function matchLocale(
    requested: readonly string[],
    available: readonly Locale[] = SUPPORTED_LOCALES,
    fallback: Locale = DEFAULT_LOCALE,
): Locale {
    if (requested.length === 0) {
        return fallback;
    }

    try {
        return match([...requested], [...available], fallback);
    } catch {
        return fallback;
    }
}

/**
 * Parse an HTTP `Accept-Language` header into language tags ordered by descending q-value, via
 * `negotiator`. An absent/empty header yields `[]`. Pure.
 */
export function localesFromAcceptLanguage(acceptLanguage: string | null | undefined): string[] {
    if (!acceptLanguage) {
        return [];
    }

    return new Negotiator({ headers: { 'accept-language': acceptLanguage } }).languages();
}
