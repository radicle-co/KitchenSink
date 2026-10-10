import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUPPORTED_LOCALES } from '@commise/i18n';

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

/**
 * The pseudo-locale (`en-XA`) is BUILD-GATED: web routes it only in a build made with `COMMISE_PSEUDO_LOCALE=1`
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B, "Pseudo-localisation"), which `next.config.ts` inlines. The
 * shared `SUPPORTED_LOCALES` is mobile's too and never changes. A production build therefore routes exactly the
 * shipped locales; `packages/infra/global/__tests__/pseudoLocaleBuildGate.test.ts` holds that no
 * workflow or Vercel configuration sets the flag.
 */
describe('routableLocales', () => {
    it('is the shipped locales alone unless the flag is exactly "1"', async () => {
        const { routableLocales } = await import('../../src/lib/i18n');

        for (const flag of [undefined, '', '0', 'true', 'yes']) {
            expect(routableLocales(flag), String(flag)).toEqual(['en']);
        }

        expect(routableLocales('1')).toEqual(['en', 'en-XA']);
    });
});

describe('a build without the pseudo-locale flag (production)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('routes the shipped locales only, so /en-XA is not a locale', async () => {
        vi.stubEnv('COMMISE_PSEUDO_LOCALE', '');
        vi.resetModules();
        const web = await import('../../src/lib/i18n');

        expect(web.ROUTABLE_LOCALES).toEqual(SUPPORTED_LOCALES);
        expect(web.isRoutableLocale('en-XA')).toBe(false);
        expect(web.localeFromPathname('/en-XA/recipes')).toBeNull();
    });
});

describe('a build with COMMISE_PSEUDO_LOCALE=1', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('routes /en-XA, and still negotiates real English browsers to en', async () => {
        vi.stubEnv('COMMISE_PSEUDO_LOCALE', '1');
        vi.resetModules();
        const web = await import('../../src/lib/i18n');

        expect(web.isRoutableLocale('en-XA')).toBe(true);
        expect(web.localeFromPathname('/en-XA/recipes')).toBe('en-XA');
        expect(web.negotiateLocale('en-US,en;q=0.9')).toBe('en');
        expect(web.negotiateLocale(null)).toBe('en');
    });
});
