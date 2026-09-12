/**
 * The seeded catalog's natural keys (plan KTD-8): `fdc:<id>` for a USDA item and `curated:<slug>` for a root
 * that stands for no USDA item. These keys are frozen at first commit, so the parser must refuse every shape
 * that could later be spelled two ways (a leading zero, a sign, a trailing space, an upper-case slug).
 */
import { describe, expect, it } from 'vitest';

import { fdcIdOf, fdcKey, isCuratedKey, isFdcKey, isSeedKey } from '../catalogKey.js';

describe('fdcKey / fdcIdOf', () => {
    it('round-trips an FDC id', () => {
        expect(fdcKey(169570)).toBe('fdc:169570');
        expect(fdcIdOf('fdc:169570')).toBe(169570);
    });

    it('refuses an id that is not a positive safe integer', () => {
        expect(() => fdcKey(0)).toThrow(/FDC id/);
        expect(() => fdcKey(-3)).toThrow(/FDC id/);
        expect(() => fdcKey(1.5)).toThrow(/FDC id/);
        expect(() => fdcKey(Number.MAX_SAFE_INTEGER + 1)).toThrow(/FDC id/);
    });
});

describe('isFdcKey', () => {
    it.each(['fdc:1', 'fdc:2646170', 'fdc:9007199254740991'])('accepts %s', (key) => {
        expect(isFdcKey(key)).toBe(true);
    });

    it.each(['fdc:0', 'fdc:01', 'fdc:-1', 'fdc:1.5', 'fdc: 1', 'fdc:1 ', 'FDC:1', 'fdc:', 'curated:x', 1, null])(
        'refuses %s',
        (key) => {
            expect(isFdcKey(key)).toBe(false);
        },
    );

    it('refuses an id beyond the safe-integer range, which would not round-trip', () => {
        expect(isFdcKey('fdc:9007199254740993')).toBe(false);
    });
});

describe('isCuratedKey / isSeedKey', () => {
    it.each(['curated:absinthe', 'curated:adobo-seasoning', 'curated:x1-2y'])('accepts %s', (key) => {
        expect(isCuratedKey(key)).toBe(true);
        expect(isSeedKey(key)).toBe(true);
    });

    it.each(['curated:', 'curated:Absinthe', 'curated:a--b', 'curated:-a', 'curated:a-', 'curated:a b', 'fdc:1'])(
        'refuses %s as a curated key',
        (key) => {
            expect(isCuratedKey(key)).toBe(false);
        },
    );

    it('a seed key is either spelling, and nothing else', () => {
        expect(isSeedKey('fdc:1')).toBe(true);
        expect(isSeedKey('slug')).toBe(false);
        expect(isSeedKey(undefined)).toBe(false);
    });
});
