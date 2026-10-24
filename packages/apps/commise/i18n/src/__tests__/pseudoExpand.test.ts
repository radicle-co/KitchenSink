import { describe, expect, it } from 'vitest';

import { resolveMessages, type LocalizedMessages } from '../dictionary.js';
import { PSEUDO_LOCALE, SUPPORTED_LOCALES } from '../locales.js';
import { pseudoExpand, pseudoString } from '../pseudo.js';

/**
 * `pseudoExpand` — the +35% pseudo-localisation `controlLabels.spec.ts` lays the web app out in
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B, "Pseudo-localisation"; buildSpec §13). A control that only fits
 * its English label wraps or overflows under it, which is what a longer real locale would do.
 */

/** The characters a reader sees, without the brackets that mark a pseudo string. */
const inner = (pseudo: string): string => pseudo.slice(1, -1);

describe('pseudoString', () => {
    it('brackets the string, so a label cut off at either end is visible', () => {
        const pseudo = pseudoString('Delete recipe');

        expect(pseudo.startsWith('[')).toBe(true);
        expect(pseudo.endsWith(']')).toBe(true);
    });

    it('accents the letters it can, so an unlocalised literal (left in English) stands out', () => {
        expect(inner(pseudoString('Save', 0)).trim()).toBe('Śáṽé');
    });

    it('grows the text by the factor, rounded up, at least', () => {
        for (const text of ['Save', 'Delete recipe', 'Pull Updates from Source']) {
            expect(inner(pseudoString(text)).length, text).toBeGreaterThanOrEqual(
                text.length + Math.ceil(text.length * 0.35),
            );
        }
    });

    it('pads by the factor ROUNDED UP, after one separating space (4 letters × 0.35 → 2)', () => {
        expect(inner(pseudoString('Save'))).toBe('Śáṽé ŀő');
    });

    it('honours a different factor', () => {
        expect(inner(pseudoString('Delete recipe', 1)).length).toBeGreaterThanOrEqual(26);
    });

    it('pads with SPACED words, so a control that cannot fit wraps instead of hiding the overflow in one token', () => {
        const padding = inner(pseudoString('Pull Updates from Source')).slice('Pull Updates from Source'.length);

        expect(padding.trim().split(' ').length).toBeGreaterThan(1);
    });

    it('keeps {placeholders} byte for byte, because fillTemplate fills them after expansion', () => {
        const pseudo = pseudoString('More actions for {title}');

        expect(pseudo).toContain('{title}');
        expect(pseudo.match(/\{[^{}]*\}/gu)).toEqual(['{title}']);
    });

    it('keeps several placeholders in order', () => {
        expect(pseudoString('{count} of {total}').match(/\{[^{}]*\}/gu)).toEqual(['{count}', '{total}']);
    });

    it('leaves an empty string empty', () => {
        expect(pseudoString('')).toBe('');
    });
});

interface Copy {
    readonly title: string;
    readonly nested: { readonly confirm: string; readonly list: readonly string[] };
    readonly limit: number;
    readonly enabled: boolean;
    readonly format: (count: number) => string;
}

const format = (count: number): string => `${count} recipes`;

const copy: Copy = {
    title: 'Recent recipes',
    nested: { confirm: 'Delete {title}', list: ['Easy', 'Hard'] },
    limit: 24,
    enabled: true,
    format,
};

describe('pseudoExpand', () => {
    it('expands every string, however deeply nested, arrays included', () => {
        const pseudo = pseudoExpand(copy);

        expect(pseudo.title).toBe(pseudoString('Recent recipes'));
        expect(pseudo.nested.confirm).toBe(pseudoString('Delete {title}'));
        expect(pseudo.nested.list).toEqual([pseudoString('Easy'), pseudoString('Hard')]);
    });

    it('leaves numbers and booleans untouched', () => {
        const pseudo = pseudoExpand(copy);

        expect(pseudo.limit).toBe(24);
        expect(pseudo.enabled).toBe(true);
    });

    // A decision, pinned: no bundle holds a function today, and a function's output cannot be reached without calling
    // it. One that appears is passed through, and shows up in English under `en-XA` — visibly, not silently.
    it('passes a function through unchanged', () => {
        expect(pseudoExpand(copy).format).toBe(format);
    });

    it('does not mutate its input', () => {
        pseudoExpand(copy);

        expect(copy.title).toBe('Recent recipes');
        expect(copy.nested.list).toEqual(['Easy', 'Hard']);
    });

    it('passes the factor down', () => {
        expect(pseudoExpand(copy, 1).title).toBe(pseudoString('Recent recipes', 1));
    });
});

describe('resolveMessages under the pseudo-locale', () => {
    const messages: LocalizedMessages<{ readonly title: string }> = { en: { title: 'Recent recipes' } };

    it('expands the en set for en-XA when the bundle has no en-XA entry', () => {
        expect(resolveMessages(messages, PSEUDO_LOCALE).title).toBe(pseudoString('Recent recipes'));
    });

    it('returns the same expanded object on every call, so a render does not re-expand a bundle', () => {
        expect(resolveMessages(messages, PSEUDO_LOCALE)).toBe(resolveMessages(messages, PSEUDO_LOCALE));
    });

    it('still prefers an explicit en-XA entry', () => {
        expect(resolveMessages({ ...messages, [PSEUDO_LOCALE]: { title: 'X' } }, PSEUDO_LOCALE).title).toBe('X');
    });

    it('leaves every other locale on its own set or en', () => {
        expect(resolveMessages(messages, 'fr').title).toBe('Recent recipes');
    });
});

describe('the pseudo-locale is not a shipped locale', () => {
    // The shared list is mobile's too. The web app adds `en-XA` to ITS routable list only in a build that asks for it.
    it('is absent from the shared SUPPORTED_LOCALES', () => {
        expect(SUPPORTED_LOCALES).toEqual(['en']);
        expect(SUPPORTED_LOCALES).not.toContain(PSEUDO_LOCALE);
    });

    it('is en-XA', () => {
        expect(PSEUDO_LOCALE).toBe('en-XA');
    });
});
