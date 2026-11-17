/**
 * The one address detector. A fact name and a written step both use it, so a link cannot pass through either by
 * being spelt a way the other door forgot.
 */
import { describe, expect, it } from 'vitest';

import { hasInvisibleCharacter, looksLikeAddress } from '../addressLike.js';

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
        ['a host spelt with the abbreviation e.g.', 'e.g.com'],
        ['the same in capitals', 'E.G.COM'],
        ['a host ending in the abbreviation p.m.', 'x.p.m.io'],
        ['a host spelt with ideographic dots and e.g.', 'e\u3002g\u3002com'],
        ['a combining grapheme joiner before the dot', 'evil\u034F.com'],
        ['a combining grapheme joiner after the dot', 'evil.\u034Fcom'],
        ['a variation selector before the dot', 'evil\uFE0F.com'],
        ['a variation selector after the dot', 'evil.\uFE00com'],
        ['a Mongolian free variation selector', 'evil\u180B.com'],
        ['a variation selector supplement character', 'evil\u{E0100}.com'],
        ['a javascript scheme', 'javascript:alert(1)'],
        ['a data scheme', 'data:text/html,hi'],
        ['a vbscript scheme in capitals', 'VBSCRIPT:x'],
        ['a file scheme', 'file:x'],
        ['a Cyrillic host with an ideographic full stop', '\u043F\u0440\u0438\u043C\u0435\u0440\u3002\u0440\u0444'],
        ['a Han top level after an ASCII host', 'evil\u3002\u4E2D\u56FD'],
        ['a Han top level with a Latin host', 'example\u3002\u516C\u53F8'],
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

    it('lets a Japanese sentence break between two Han or kana characters through', () => {
        expect(looksLikeAddress('\u6EB6\u304B\u3057\u307E\u3059\u3002\u6B21\u306B\u9032\u307F\u307E\u3059')).toBe(
            false,
        );
        expect(looksLikeAddress('\u5317\u4EAC\u3002\u4E2D\u56FD')).toBe(false);
    });

    it('is pure on repeated calls, with no regex state carried between them', () => {
        expect(looksLikeAddress('evil.com')).toBe(true);
        expect(looksLikeAddress('evil.com')).toBe(true);
        expect(looksLikeAddress('plain')).toBe(false);
    });
});

describe('hasInvisibleCharacter', () => {
    it.each(['\u034F', '\uFE0F', '\uFE00', '\u180B', '\u{E0100}', '\u00AD', '\u2060', '\u200B'])(
        'flags the default-ignorable character U+%s',
        (mark) => {
            expect(hasInvisibleCharacter(`evil${mark}x`)).toBe(true);
        },
    );

    it('lets the joiners that real scripts need through, and plain text', () => {
        expect(hasInvisibleCharacter('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645')).toBe(false);
        expect(hasInvisibleCharacter('\u0915\u094D\u200D\u0937')).toBe(false);
        expect(hasInvisibleCharacter('Stir, then serve.')).toBe(false);
        expect(hasInvisibleCharacter('')).toBe(false);
    });
});
