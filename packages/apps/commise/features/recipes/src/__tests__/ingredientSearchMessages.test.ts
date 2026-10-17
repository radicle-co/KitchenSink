/**
 * The search-minimum copy is present, templated, and complete in EVERY locale the dictionary carries
 * (003-FR-010a, plan U37).
 *
 * ⛔ WHAT THE TYPE SYSTEM ALREADY GUARANTEES, so this file does not re-assert it: `LocalizedMessages<T>` is
 * `{ readonly en: T } & Partial<Record<Locale, T>>`, so a missing `en.ingredientSearch.tooShort` is a
 * COMPILE error, not a test failure. `en` is also the only locale shipped today (`SUPPORTED_LOCALES`).
 *
 * ⛔ WHAT IT CANNOT: that a locale which IS present is complete (its entry is `Partial` only at the locale
 * level — the whole `T` must be there, but a translator adding `fr` mid-edit can leave a partial object that
 * only fails at runtime), and that the sentence still carries its `{minimum}` placeholder. That second one is
 * the live hazard: a copy edit dropping the placeholder renders "Keep typing — characters or more" — a
 * grammatical, plausible sentence that silently stops telling the cook the one number the whole requirement
 * is about, and no rendering test that greps for a literal would catch it either, because such a test would
 * have been updated to match.
 *
 * The cases below iterate whatever locales the dictionary HAS, so they keep their bite as locales are added
 * rather than needing an edit per language.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages, type RecipeMessages } from '../messages.js';

/**
 * Every locale entry the dictionary actually carries, as `[tag, messages]` pairs.
 *
 * ⚠️ The `undefined` is filtered rather than asserted away: `LocalizedMessages<T>` types every non-default
 * locale as `Partial`, so `Object.entries` widens the value. A locale key present with an `undefined` value
 * is itself a defect, so it is asserted separately below rather than silently narrowed here.
 */
const LOCALE_ENTRIES: [string, RecipeMessages][] = Object.entries(recipeMessages).flatMap(([locale, messages]) =>
    messages === undefined ? [] : [[locale, messages] as [string, RecipeMessages]],
);

describe('recipeMessages.ingredientSearch (003-FR-010a)', () => {
    it('carries at least the default locale, so the cases below are not vacuous', () => {
        expect(LOCALE_ENTRIES.length).toBeGreaterThan(0);
        expect(Object.keys(recipeMessages)).toContain('en');
        // Every declared locale resolves to a real message set — a key with an `undefined` value would be
        // silently dropped by the filter above and take its assertions with it.
        expect(LOCALE_ENTRIES.map(([locale]) => locale)).toEqual(Object.keys(recipeMessages));
    });

    it.each(LOCALE_ENTRIES)('defines a non-empty tooShort message for %s', (_locale, messages) => {
        expect(messages.ingredientSearch.tooShort.trim()).not.toBe('');
    });

    it.each(LOCALE_ENTRIES)(
        'keeps the {minimum} placeholder in %s, so the number is never hard-coded',
        (_locale, messages) => {
            expect(messages.ingredientSearch.tooShort).toContain('{minimum}');
            // ⛔ And no bare digit standing in for it: `fillTemplate` would leave a literal "3" untouched, so a
            // sentence carrying BOTH would read "Keep typing — 3 characters or more, at least 3" after a retune.
            expect(messages.ingredientSearch.tooShort).not.toMatch(/\d/);
        },
    );

    it.each(LOCALE_ENTRIES)('does not reuse the no-matches wording in %s', (_locale, messages) => {
        // The two states are different claims: "no matching ingredients" asserts the catalog was searched
        // and came back empty. Below the minimum nothing was searched, and conflating them is the exact
        // mistake this empty state exists to prevent.
        expect(messages.ingredientSearch.tooShort.toLowerCase()).not.toContain('no matching');
    });
});
