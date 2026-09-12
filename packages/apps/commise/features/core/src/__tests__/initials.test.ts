/**
 * Unit tests for viewer-initials derivation (Home chrome avatar, US-000).
 *
 * Requirement map:
 *  - FR-046 / Home chrome — the top-bar avatar shows the REAL viewer's initials (the mockup's "JD"), so the
 *    host needs a pure derivation that degrades sanely for the no-name / whitespace / emoji / CJK cases.
 */
import { describe, expect, it } from 'vitest';

import { initialsFor } from '../utils/initials.js';

describe('initialsFor', () => {
    describe('display names', () => {
        it('takes the first letter of the first and last word', () => {
            expect(initialsFor('Jane Doe')).toBe('JD');
        });

        it('ignores middle words rather than producing three letters', () => {
            expect(initialsFor('Jane Quinn Doe')).toBe('JD');
        });

        it('uses a single letter for a single-word name', () => {
            expect(initialsFor('Cher')).toBe('C');
        });

        it('upper-cases lowercase input', () => {
            expect(initialsFor('jane doe')).toBe('JD');
        });

        it('collapses irregular whitespace instead of emitting blanks', () => {
            expect(initialsFor('  Jane   Doe  ')).toBe('JD');
            expect(initialsFor('Jane\tDoe')).toBe('JD');
            expect(initialsFor('Jane\nDoe')).toBe('JD');
        });
    });

    describe('non-latin and multi-code-point names (must never split a glyph)', () => {
        it('uses whole code points for names outside the BMP', () => {
            // '𝒥' is a surrogate pair; a naive `name[0]` would emit half of it (a replacement glyph).
            expect(initialsFor('𝒥ane 𝒟oe')).toBe('𝒥𝒟');
        });

        it('handles CJK names', () => {
            expect(initialsFor('山田 太郎')).toBe('山太');
        });

        /**
         * REWRITTEN (was `'🍳'` → `'🍳'`). An initial is a LETTER. The old expectation passed only because 🍳 is a
         * single code point; the same code-point rule emitted a lone regional indicator for a flag and a
         * truncated ZWJ sequence for a profession emoji (the cases below). A name with no letter now yields `''`
         * and both top bars draw their existing no-initials fallback, so no glyph is ever split.
         */
        it('derives nothing from an emoji-only display name, leaving the fallback to the caller', () => {
            expect(initialsFor('🍳')).toBe('');
            expect(initialsFor('👩‍🍳')).toBe('');
            expect(initialsFor('🇫🇷')).toBe('');
        });

        it('skips a leading flag rather than emitting half of it', () => {
            // A flag is TWO regional-indicator code points; the first alone renders as a boxed letter.
            expect(initialsFor('🇫🇷 Marie Curie')).toBe('MC');
        });

        it('skips a leading ZWJ emoji sequence rather than emitting its first code point', () => {
            // 👩‍🍳 is 👩 + ZWJ + 🍳; its first code point alone is a different emoji.
            expect(initialsFor('👩‍🍳 Chef')).toBe('C');
        });

        it('keeps a combining mark with the letter it modifies', () => {
            // A decomposed É is `E` + U+0301; taking the `E` alone drops the accent. Escaped so no editor
            // silently normalises the fixture to the precomposed form, which would pass without the fix.
            expect(initialsFor('E\u0301mile Zola')).toBe('E\u0301Z');
        });
    });

    describe('words that are not a name part', () => {
        it('ignores a trailing parenthetical such as pronouns', () => {
            expect(initialsFor('Jane Doe (she/her)')).toBe('JD');
        });

        it('ignores a quoted nickname in the middle and at the end', () => {
            expect(initialsFor('Robert "Bob" Smith')).toBe('RS');
            expect(initialsFor('Robert Smith "Bob"')).toBe('RS');
        });

        it('returns an empty string when no word starts with a letter', () => {
            expect(initialsFor('(she/her) 123')).toBe('');
        });
    });

    describe('absent / unusable names (the no-name viewer)', () => {
        it('returns an empty string for undefined', () => {
            expect(initialsFor(undefined)).toBe('');
        });

        it('returns an empty string for an empty name', () => {
            expect(initialsFor('')).toBe('');
        });

        it('returns an empty string for a whitespace-only name', () => {
            expect(initialsFor('   ')).toBe('');
        });
    });
});
