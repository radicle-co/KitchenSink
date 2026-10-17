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
import { bodyFontFace, displayFontFace, fontFamily, fontWeight } from '../scale.js';
import { typeRole } from '../typography.js';

/** A single registered face name: letters/digits/underscores only — never a comma-separated CSS stack. */
const REGISTERED_FACE = /^[A-Za-z][A-Za-z0-9_]*$/u;

/** The body family's PRIMARY family name, spaces stripped (`Inter`). */
const bodyFamilyToken = (fontFamily.body.split(',')[0] ?? '').replaceAll('"', '').replaceAll(' ', '');

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

describe('bodyFontFace — registered native faces (§1.5: Inter 400/500/600/700)', () => {
    it('names the faces `@expo-google-fonts/inter` registers', () => {
        expect(bodyFontFace).toEqual({
            normal: 'Inter_400Regular',
            medium: 'Inter_500Medium',
            semibold: 'Inter_600SemiBold',
            bold: 'Inter_700Bold',
        });
    });

    it('has a face for every weight step of the shared scale', () => {
        expect(Object.keys(bodyFontFace).sort()).toEqual(Object.keys(fontWeight).sort());
    });

    it('derives every face from the body family and its weight step (no stale face on a rename)', () => {
        for (const [weightName, face] of Object.entries(bodyFontFace)) {
            const weight = fontWeight[weightName as keyof typeof fontWeight];

            expect(face).toContain(bodyFamilyToken);
            expect(face).toContain(`_${weight}`);
        }
    });
});

describe('native type roles select a face per weight, never a weight on a family', () => {
    // §1.5: "A native role selects a face per weight, never `fontFamily` plus `fontWeight` together" — Android
    // resolves the pair to a SYNTHESISED or system bold rather than the registered face.
    it('no native type role carries a fontWeight', () => {
        for (const entry of Object.values(nativeTokens.type)) {
            const styles = 'fontFamily' in entry ? [entry] : Object.values(entry);

            for (const style of styles) {
                expect(style).not.toHaveProperty('fontWeight');
                expect(style.fontFamily).toMatch(REGISTERED_FACE);
            }
        }
    });

    it('covers every type role', () => {
        expect(Object.keys(nativeTokens.type).sort()).toEqual(Object.keys(typeRole).sort());
    });
});

describe('native tokens expose no CSS font stack', () => {
    it('every native face value is ONE registered face name, never a comma-containing stack', () => {
        for (const face of [
            ...Object.values(nativeTokens.fontFace.display),
            ...Object.values(nativeTokens.fontFace.body),
        ]) {
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
        expect(nativeTokens.fontFace.body).toEqual(bodyFontFace);
    });
});
