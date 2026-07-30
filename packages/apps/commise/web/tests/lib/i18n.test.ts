import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, localeFromPathname, negotiateLocale, withLocalePath } from '../../src/lib/i18n';

describe('localeFromPathname', () => {
    it('returns the locale when the path is prefixed with a supported locale', () => {
        expect(localeFromPathname('/en')).toBe('en');
        expect(localeFromPathname('/en/profile')).toBe('en');
        expect(localeFromPathname('/en/sign-in')).toBe('en');
    });

    it('returns null for a locale-less path', () => {
        expect(localeFromPathname('/')).toBeNull();
        expect(localeFromPathname('/profile')).toBeNull();
    });

    it('returns null for an unsupported-locale prefix (only shipped locales count)', () => {
        expect(localeFromPathname('/fr/profile')).toBeNull();
        expect(localeFromPathname('/enx/profile')).toBeNull();
    });
});

describe('withLocalePath', () => {
    it('prefixes a path with the locale', () => {
        expect(withLocalePath('/profile', 'en')).toBe('/en/profile');
        expect(withLocalePath('/sign-in', 'en')).toBe('/en/sign-in');
    });

    it('maps the bare root to /{locale} (no trailing slash)', () => {
        expect(withLocalePath('/', 'en')).toBe('/en');
    });
});

describe('negotiateLocale', () => {
    it('resolves a supported locale from Accept-Language', () => {
        expect(negotiateLocale('en-US,en;q=0.9')).toBe('en');
    });

    it('falls back to the default for unsupported languages', () => {
        expect(negotiateLocale('fr-FR,fr;q=0.9,de;q=0.8')).toBe(DEFAULT_LOCALE);
    });

    it('falls back to the default for an absent/empty header', () => {
        expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
        expect(negotiateLocale('')).toBe(DEFAULT_LOCALE);
    });
});
