import {
    PSEUDO_LOCALE,
    fillTemplate,
    localesFromAcceptLanguage,
    matchLocale,
    pluralOf,
    resolveMessages,
    type LocalizedMessages,
    type PluralText,
} from '@commise/i18n';
import { describe, expect, it } from 'vitest';

/**
 * The i18n chain through the package's PUBLIC surface: the `exports` map and `src/index.ts`, with the real `Intl`, the real
 * locale matcher and the real pseudo-locale expansion, and nothing mocked. The unit tier imports each module by path, so
 * only this tier fails when the barrel stops exporting something or two modules stop agreeing: the locale a request picks
 * is the locale the dictionary resolves, and the plural form `pluralOf` picks is the one `fillTemplate` fills.
 *
 * The catalog lives here, in the shape feature packages use. `@commise/i18n` must not import a feature package, because
 * every feature package imports it.
 */

interface CookingCopy {
    readonly steps: PluralText;
    readonly note: string;
}

const CATALOG: LocalizedMessages<CookingCopy> = {
    en: {
        steps: { one: '{count} of {total} step', other: '{count} of {total} steps' },
        note: 'Cook {constructor} with {toString}',
    },
};

/** The message a screen shows: the locale a request picks, the copy it resolves, the plural form, the token fill. */
function stepsLine(acceptLanguage: string, count: number, total: number): string {
    const locale = matchLocale(localesFromAcceptLanguage(acceptLanguage));

    return fillTemplate(pluralOf(resolveMessages(CATALOG, locale).steps, count, locale), { total });
}

describe('I1 — a count message goes through the whole chain', () => {
    it.each([
        [0, '0 of 5 steps'],
        [1, '1 of 5 step'],
        [2, '2 of 5 steps'],
        [21, '21 of 5 steps'],
    ])('at %i it reads "%s", with no placeholder left', (count, expected) => {
        const line = stepsLine('fr-CA, en;q=0.8', count, 5);

        expect(line).toBe(expected);
        expect(line).not.toContain('{');
    });
});

describe('I2 — the pseudo locale keeps every placeholder and still fills', () => {
    const pseudo = resolveMessages(CATALOG, PSEUDO_LOCALE);

    it('expands the real message object and keeps each {placeholder} byte for byte', () => {
        expect(pseudo.steps.one).toContain('{count}');
        expect(pseudo.steps.one).toContain('{total}');
        expect(pseudo.steps.other).toContain('{count}');
        expect(pseudo.steps.other).toContain('{total}');
        expect(pseudo.note).toContain('{constructor}');
        expect(pseudo.steps.other).not.toBe(CATALOG.en.steps.other);
    });

    it('fills the count and the named token in the expanded text', () => {
        const line = fillTemplate(pluralOf(pseudo.steps, 3, PSEUDO_LOCALE), { total: 5 });

        expect(line).not.toContain('{');
        expect(line).toContain('3');
        expect(line).toContain('5');
        expect(line.startsWith('[')).toBe(true);
    });
});

describe('I3 — a token named like an inherited object member is the caller’s to give', () => {
    const note = resolveMessages(CATALOG, PSEUDO_LOCALE).note;

    it('leaves {constructor} and {toString} as written when the caller gives other tokens', () => {
        const line = fillTemplate(note, { total: 5 });

        expect(line).toContain('{constructor}');
        expect(line).toContain('{toString}');
        expect(line).not.toContain('native code');
    });

    it('fills {constructor} when the caller gives it as its own key, and still leaves {toString}', () => {
        const line = fillTemplate(note, { constructor: 'cook' });

        expect(line).toContain('cook');
        expect(line).not.toContain('{constructor}');
        expect(line).toContain('{toString}');
    });
});
