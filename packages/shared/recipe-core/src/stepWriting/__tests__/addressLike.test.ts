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
        ['a full-width full stop between ASCII letters', 'evil\uFF0Ecom'],
        ['a host spelt with the abbreviation e.g.', 'e.g.com'],
        ['the same in capitals', 'E.G.COM'],
        ['a host ending in the abbreviation p.m.', 'x.p.m.io'],
        ['a combining grapheme joiner before the dot', 'evil\u034F.com'],
        ['a combining grapheme joiner after the dot', 'evil.\u034Fcom'],
        ['a variation selector before the dot', 'evil\uFE0F.com'],
        ['a variation selector after the dot', 'evil.\uFE00com'],
        ['a Mongolian free variation selector', 'evil\u180B.com'],
        ['a variation selector supplement character', 'evil\u{E0100}.com'],
        ['a short host', 't.co'],
        ['a tight abbreviation not on the list', 'fl.oz'],
        ['a javascript scheme', 'javascript:alert(1)'],
        ['a data scheme', 'data:text/html,hi'],
        ['a scheme split by a tab', 'java\tscript:alert(1)'],
        ['a scheme split by a line break', 'java\nscript:alert(1)'],
        ['a scheme split by a carriage return', 'data\r:text/html,hi'],
        ['a vbscript scheme in capitals', 'VBSCRIPT:x'],
        ['a file scheme', 'file:x'],
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
        'A.1. sauce',
        '2 fl.oz.',
        'St. Louis',
        '2.5',
        '1:30',
        '\u00BD cup',
        'Serve at 7 a.m. with toast, e.g. rye.',
        'Dough rests, i.e. proofs, until 5 P.M.',
        'fl. oz',
        'salt + pepper',
        'chicken (boneless/skinless)',
        "'nduja",
        'Stir for 1:30 minutes.',
        'Bake at 200 \u00B0C.',
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
