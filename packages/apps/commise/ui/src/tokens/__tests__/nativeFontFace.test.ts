/**
 * Guard for the native font-face contract (U8). React Native resolves `fontFamily` to ONE **registered
 * face name**; a CSS font stack (`'"Playfair Display", Georgia, serif'`) is not a face, so RN silently
 * falls back to the system font and the brand type never renders — a defect with no visible failure.
 *
 * These tests make that class of bug unrepresentable from the token side:
 *  1. `nativeTokens` exposes NO CSS font stack at all (the web stacks stay web-only), so a native consumer
 *     cannot reach one through the design system.
 *  2. Every value in the native face registry is a single registered face name — no comma, no space, no
 *     quotes. This is the assertion that fails if a stack is ever reintroduced.
 *  3. The face names are DERIVED from this module's own family + weight tokens (family name with spaces
 *     stripped, weight number embedded), so renaming the display family or moving a weight step cannot
 *     leave a stale face name silently pointing at a font nobody loads.
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../native.js';
import { displayFontFace, fontFamily, fontWeight } from '../scale.js';

/** A single registered face name: letters/digits/underscores only — never a comma-separated CSS stack. */
const REGISTERED_FACE = /^[A-Za-z][A-Za-z0-9_]*$/u;

/** The display family's PRIMARY family name, quotes and spaces stripped (`PlayfairDisplay`). */
const displayFamilyToken = (fontFamily.display.split(',')[0] ?? '').replaceAll('"', '').replaceAll(' ', '');

describe('displayFontFace — registered native faces', () => {
    it('names the faces `@expo-google-fonts/playfair-display` registers', () => {
        expect(displayFontFace).toEqual({
            semibold: 'PlayfairDisplay_600SemiBold',
            bold: 'PlayfairDisplay_700Bold',
        });
    });

    it('is keyed by real weight steps of the shared scale', () => {
        for (const key of Object.keys(displayFontFace)) {
            expect(fontWeight).toHaveProperty(key);
        }
    });

    it('derives every face from the display family and its weight step (no stale face on a rename)', () => {
        for (const [weightName, face] of Object.entries(displayFontFace)) {
            const weight = fontWeight[weightName as keyof typeof fontWeight];

            expect(face).toContain(displayFamilyToken);
            expect(face).toContain(`_${weight}`);
        }
    });
});

describe('native tokens expose no CSS font stack', () => {
    it('every native face value is ONE registered face name, never a comma-containing stack', () => {
        for (const face of Object.values(nativeTokens.fontFace.display)) {
            expect(face).not.toContain(',');
            expect(face).toMatch(REGISTERED_FACE);
        }
    });

    it('does not expose the web `fontFamily` stacks to native consumers at all', () => {
        expect(nativeTokens).not.toHaveProperty('fontFamily');
        // …and the web stack it would have carried is exactly the value RN cannot resolve.
        expect(fontFamily.display).toContain(',');
    });

    it('projects the scale registry unchanged onto `nativeTokens.fontFace`', () => {
        expect(nativeTokens.fontFace.display).toEqual(displayFontFace);
    });
});
