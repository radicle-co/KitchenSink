import { DEFAULT_LOCALE, PSEUDO_LOCALE, type Locale } from './locales.js';
import { pseudoExpand } from './pseudo.js';

/**
 * A set of user-facing messages localized across locales. The {@link DEFAULT_LOCALE} (`en`) entry is
 * REQUIRED — it is the guaranteed fallback; every other locale is optional and, when absent, falls back
 * to it. Feature/component `messages.ts` files export values of this shape; web (`getDictionary`) and
 * mobile both resolve them via {@link resolveMessages}.
 */
export type LocalizedMessages<T> = { readonly en: T } & Partial<Record<Locale, T>>;

/**
 * Each `en` set's pseudo-localised copy, made once. A memo of a pure function, keyed weakly so a bundle that is
 * dropped takes its copy with it; it keeps {@link resolveMessages} referentially stable for a render.
 */
const pseudoCopies = new WeakMap<object, unknown>();

/**
 * The `en` set, pseudo-localised, from the memo: the same input always yields the same object.
 *
 * @sideEffect Fills {@link pseudoCopies} on a bundle's first resolution.
 */
function pseudoOf<T>(english: T): T {
    if (typeof english !== 'object' || english === null) {
        return pseudoExpand(english);
    }

    if (!pseudoCopies.has(english)) {
        pseudoCopies.set(english, pseudoExpand(english));
    }

    return pseudoCopies.get(english) as T;
}

/**
 * Resolve the message set for `locale`, falling back to the required {@link DEFAULT_LOCALE} set when the
 * locale has no dedicated entry. Under the {@link PSEUDO_LOCALE} that fallback is the `en` set pseudo-localised
 * (`./pseudo.ts`), so every bundle reaches it with no entry of its own. `locale` is expected to already be a
 * negotiated/supported tag. Pure.
 */
export function resolveMessages<T>(messages: LocalizedMessages<T>, locale: Locale): T {
    const own = (messages as Partial<Record<Locale, T>>)[locale];

    if (own !== undefined) {
        return own;
    }

    return locale === PSEUDO_LOCALE ? pseudoOf(messages[DEFAULT_LOCALE]) : messages[DEFAULT_LOCALE];
}
