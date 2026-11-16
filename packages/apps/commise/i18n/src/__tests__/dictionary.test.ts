import { describe, expect, it } from 'vitest';

import { resolveMessages, servedLocaleOf, type LocalizedMessages } from '../dictionary.js';

interface Copy {
    readonly title: string;
}

// `en` required (the guaranteed fallback); `es` is a partial second locale, `en-XA` a pseudo-locale.
const messages: LocalizedMessages<Copy> = {
    en: { title: 'Recent recipes' },
    es: { title: 'Recetas recientes' },
    'en-XA': { title: '[Ŕéçéñţ ŕéçìþéš]' },
};

describe('resolveMessages', () => {
    it('returns the exact locale set when present', () => {
        expect(resolveMessages(messages, 'es').title).toBe('Recetas recientes');
        expect(resolveMessages(messages, 'en-XA').title).toBe('[Ŕéçéñţ ŕéçìþéš]');
    });

    it('falls back to the required en set for a locale with no dedicated entry', () => {
        expect(resolveMessages(messages, 'fr').title).toBe('Recent recipes');
    });

    it('resolves en itself', () => {
        expect(resolveMessages(messages, 'en').title).toBe('Recent recipes');
    });

    it('falls back when a dictionary defines ONLY en (the single-shipped-locale case)', () => {
        const enOnly: LocalizedMessages<Copy> = { en: { title: 'Only English' } };

        expect(resolveMessages(enOnly, 'es').title).toBe('Only English');
    });
});

describe('servedLocaleOf', () => {
    it('is the requested locale when the catalog has its own set', () => {
        expect(servedLocaleOf(messages, 'es')).toBe('es');
    });

    it('is en when the request fell back to the required en set, whatever was asked', () => {
        expect(servedLocaleOf(messages, 'fr-CA')).toBe('en');
        expect(servedLocaleOf({ en: { title: 'Only English' } }, 'es')).toBe('en');
    });

    it('names the locale of the set resolveMessages returns', () => {
        for (const asked of ['en', 'es', 'fr']) {
            const served = servedLocaleOf(messages, asked);

            expect(resolveMessages(messages, asked)).toBe(messages[served]);
        }
    });
});
