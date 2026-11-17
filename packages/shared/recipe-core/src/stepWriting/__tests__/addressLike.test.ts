/**
 * The one address detector. A fact name and a written step both use it, so a link cannot pass through either by
 * being spelt a way the other door forgot.
 */
import { describe, expect, it } from 'vitest';

import { looksLikeAddress } from '../addressLike.js';

describe('looksLikeAddress', () => {
    it.each([
        ['a scheme', 'https://evil.example/x'],
        ['a double slash', 'see //evil'],
        ['a www host', 'www.evil.example'],
        ['a dotted domain', 'evil.example'],
        ['a domain with a path', 'evil.com/x'],
        ['a digit in the top level', 'evil.c0m/x'],
        ['a digit in the host', 'evil2.com'],
        ['digits after the dot', 'evil.123/x'],
        ['an IPv4 address with a path', '192.168.1.1/x'],
        ['an IPv4 address alone', '10.0.0.1'],
        ['a host and port', 'localhost:3000/x'],
        ['a host and port with no path', 'localhost:8080'],
        ['an ideographic full stop between ASCII letters', 'evil\u3002com/x'],
        ['a full-width full stop between ASCII letters', 'evil\uFF0Ecom'],
        ['a half-width ideographic full stop', 'evil\uFF61com'],
        ['full-width letters and an ideographic full stop', 'ｅｖｉｌ。ｃｏｍ'],
        ['mixed-width letters and an ideographic full stop', 'evil。ｃom'],
        ['a full-width colon and slashes', 'http\uFF1A\uFF0F\uFF0Fevil'],
    ])('flags %s', (_what, text) => {
        expect(looksLikeAddress(text)).toBe(true);
    });

    it.each([
        'St. Louis ribs',
        '2.5% milk',
        '3.5 oz',
        '1.5kg flour',
        'oz.',
        'Serve at 7 a.m. with toast, e.g. rye.',
        'Dough rests, i.e. proofs, until 5 P.M.',
        'fl. oz',
        'salt + pepper',
        'chicken (boneless/skinless)',
        "'nduja",
        'Stir for 1:30 minutes.',
        'Bake at 200 \u00B0C.',
        '\u30D0\u30BF\u30FC\u3092\u6EB6\u304B\u3057\u307E\u3059\u3002\u6B21\u306B\u6DB2\u3092\u52A0\u3048\u307E\u3059\u3002',
        '',
    ])('lets %j through', (text) => {
        expect(looksLikeAddress(text)).toBe(false);
    });

    it('is pure on repeated calls, with no regex state carried between them', () => {
        expect(looksLikeAddress('evil.com')).toBe(true);
        expect(looksLikeAddress('evil.com')).toBe(true);
        expect(looksLikeAddress('plain')).toBe(false);
    });
});
