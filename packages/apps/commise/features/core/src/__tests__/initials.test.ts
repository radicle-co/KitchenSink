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

    describe('non-latin and multi-code-unit names (must not split a surrogate pair)', () => {
        it('uses whole code points for names outside the BMP', () => {
            // '𝒥' is a surrogate pair; a naive `name[0]` would emit half of it (a replacement glyph).
            expect(initialsFor('𝒥ane 𝒟oe')).toBe('𝒥𝒟');
        });

        it('handles CJK names', () => {
            expect(initialsFor('山田 太郎')).toBe('山太');
        });

        it('handles an emoji-only display name without emitting a broken glyph', () => {
            expect(initialsFor('🍳')).toBe('🍳');
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
