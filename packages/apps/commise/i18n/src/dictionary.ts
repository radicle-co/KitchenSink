import { DEFAULT_LOCALE, type Locale } from './locales.js';

/**
 * A set of user-facing messages localized across locales. The {@link DEFAULT_LOCALE} (`en`) entry is
 * REQUIRED — it is the guaranteed fallback; every other locale is optional and, when absent, falls back
 * to it. Feature/component `messages.ts` files export values of this shape; web (`getDictionary`) and
 * mobile both resolve them via {@link resolveMessages}.
 */
export type LocalizedMessages<T> = { readonly en: T } & Partial<Record<Locale, T>>;

/**
 * Resolve the message set for `locale`, falling back to the required {@link DEFAULT_LOCALE} set when the
 * locale has no dedicated entry. `locale` is expected to already be a negotiated/supported tag. Pure.
 */
export function resolveMessages<T>(messages: LocalizedMessages<T>, locale: Locale): T {
    return (messages as Partial<Record<Locale, T>>)[locale] ?? messages[DEFAULT_LOCALE];
}
