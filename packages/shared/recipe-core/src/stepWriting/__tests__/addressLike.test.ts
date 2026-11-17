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
        ['a tel scheme', 'tel:+15551234'],
        ['an sms scheme', 'sms:+15551234'],
        ['a javascript scheme', 'javascript:alert(1)'],
        ['a data scheme', 'data:text/html,hi'],
        ['a scheme split by a tab', 'java\tscript:alert(1)'],
        ['a scheme split by a line break', 'java\nscript:alert(1)'],
        ['a scheme split by a carriage return', 'data\r:text/html,hi'],
        ['a vbscript scheme in capitals', 'VBSCRIPT:x'],
        ['a file scheme', 'file:x'],
        ['a registered sign before the dot', 'evil\u00AE.com'],
        ['a multiplication sign before the dot', 'evil\u00D7.com'],
        ['a single curly quote before the dot', 'evil\u2018.com'],
        ['an apostrophe before the dot', 'evil\u2019.com'],
        ['a degree sign before the dot', 'evil\u00B0.com'],
        ['a parenthesis before the dot', 'evil).com'],
        ['an ampersand before the dot', 'evil&.com'],
        ['a plus before the dot', 'evil+.com'],
        ['a hyphen before the dot', 'evil-.com'],
        ['two marked labels', 'www\u00AE.evil\u00AE.com'],
        ['a degree Celsius sign after the dot', 'evil.\u2103om'],
        ['an ellipsis for a dot', 'evil\u2026com'],
        ['a leading dot host', '.com'],
        ['a leading dot host after a space', 'open .com'],
        ['a percent-escaped dot', 'evil%2Ecom'],
        ['an invalid escape before an escaped dot', 'evil%FF%2Ecom'],
        ['an invalid escape after an escaped dot', 'evil%2E%FFcom'],
        ['an invalid escape before an escaped full-width dot', 'evil%FF%EF%BC%8Ecom'],
        ['a double percent-escaped dot', 'evil%252Ecom'],
        ['a percent-escaped full-width dot', 'evil%EF%BC%8Ecom'],
        ['a tight dot before a digit after a letter', 'evil.1'],
        ['a full-width scheme and colon', '\uFF4A\uFF41\uFF56\uFF41\uFF53\uFF43\uFF52\uFF49\uFF50\uFF54\uFF1Aalert(1)'],
        ['a trade mark hiding a javascript scheme', 'Stir \u2122javascript:alert(1) now.'],
        ['a degree Celsius sign hiding a mailto scheme', '\u2103mailto:a@b'],
        ['a trade mark hiding a tel scheme', '\u2122tel:+15551234'],
        ['a trade mark hiding an sms scheme', '\u2122sms:+15551234'],
        ['a trade mark hiding a data scheme', '\u2122data:text/html,hi'],
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
        '2.5 cups',
        '10.5.',
        'Mix well. Then bake.',
        'Wait\u2026 then bake.',
        '.5 tsp',
        '50% off, 100%',
        '100%Dark chocolate',
        '100%Beef',
        'Serve (hot).',
        'Bake 10 min.',
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
