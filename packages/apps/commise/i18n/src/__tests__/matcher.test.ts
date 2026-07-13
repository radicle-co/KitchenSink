import { describe, expect, it } from 'vitest';

import { localesFromAcceptLanguage, matchLocale } from '../matcher.js';

// A test-only locale set (a real second locale `es` + an accented pseudo-locale `en-XA`) exercises the
// N-locale machinery without shipping invented content. The app ships only `en` (SUPPORTED_LOCALES).
const AVAILABLE = ['en', 'es', 'en-XA'] as const;

describe('matchLocale', () => {
    it('picks an exact match', () => {
        expect(matchLocale(['es'], AVAILABLE, 'en')).toBe('es');
        expect(matchLocale(['en-XA'], AVAILABLE, 'en')).toBe('en-XA');
    });

    it('matches by language subtag when the exact region is unavailable', () => {
        // es-MX is not available, but es is → BCP-47 lookup falls to the language subtag.
        expect(matchLocale(['es-MX'], AVAILABLE, 'en')).toBe('es');
    });

    it('honors preference order (first requested that is available wins)', () => {
        expect(matchLocale(['fr', 'es', 'en'], AVAILABLE, 'en')).toBe('es');
    });

    it('falls back when nothing matches', () => {
        expect(matchLocale(['fr', 'de'], AVAILABLE, 'en')).toBe('en');
    });

    it('falls back for an empty request list', () => {
        expect(matchLocale([], AVAILABLE, 'en')).toBe('en');
    });

    it('falls back (never throws) on a malformed language tag', () => {
        expect(matchLocale(['not a tag!!'], AVAILABLE, 'en')).toBe('en');
    });

    it('defaults available to SUPPORTED_LOCALES and fallback to DEFAULT_LOCALE (ships en only)', () => {
        expect(matchLocale(['es'])).toBe('en'); // es is not shipped → default
        expect(matchLocale(['en'])).toBe('en');
    });
});

describe('localesFromAcceptLanguage', () => {
    it('orders tags by descending q-value', () => {
        expect(localesFromAcceptLanguage('fr;q=0.5,en;q=0.9,es;q=0.8')).toEqual(['en', 'es', 'fr']);
    });

    it('keeps region subtags and default (q=1) ordering', () => {
        expect(localesFromAcceptLanguage('en-US,en;q=0.9')).toEqual(['en-US', 'en']);
    });

    it('returns [] for an absent or empty header', () => {
        expect(localesFromAcceptLanguage(null)).toEqual([]);
        expect(localesFromAcceptLanguage(undefined)).toEqual([]);
        expect(localesFromAcceptLanguage('')).toEqual([]);
    });

    it('feeds matchLocale end-to-end (header → negotiated locale)', () => {
        const requested = localesFromAcceptLanguage('es-MX,es;q=0.9,en;q=0.5');

        expect(matchLocale(requested, AVAILABLE, 'en')).toBe('es');
    });
});
