/**
 * `measureTextWidth` reads the app's own font files, so a fit test can ask whether a label fits its slot in the face
 * and size the device draws it in. These rows hold the measure to the font: it must change with the face, the size and
 * the words, and it must refuse a face the app does not load rather than measure a fallback.
 */
import { describe, expect, it } from 'vitest';

import { bodyFontFace, displayFontFace } from '../../tokens/scale.js';
import { measureTextWidth } from '../measureText.js';

describe('measureTextWidth', () => {
    it('measures nothing for no words', () => {
        expect(measureTextWidth('', bodyFontFace.medium, 16)).toBe(0);
    });

    it('grows in step with the size', () => {
        const at16 = measureTextWidth('Recipes', bodyFontFace.medium, 16);

        expect(at16).toBeGreaterThan(0);
        expect(measureTextWidth('Recipes', bodyFontFace.medium, 32)).toBeCloseTo(at16 * 2, 6);
    });

    it('reads the glyphs, so a wide letter measures wider than a narrow one', () => {
        expect(measureTextWidth('WWWW', bodyFontFace.normal, 16)).toBeGreaterThan(
            measureTextWidth('iiii', bodyFontFace.normal, 16) * 2,
        );
    });

    it('reads each face from its own file', () => {
        const regular = measureTextWidth('Discover', bodyFontFace.normal, 16);

        expect(measureTextWidth('Discover', bodyFontFace.semibold, 16)).not.toBeCloseTo(regular, 3);
        expect(measureTextWidth('Discover', displayFontFace.semibold, 16)).not.toBeCloseTo(regular, 3);
    });

    // The font's own advance widths, kerning applied, for the lockfile's @expo-google-fonts/inter 0.4.2. A measure that
    // ignored the face, the size or the kerning could not land on these.
    it('lands on the font’s own advance widths', () => {
        expect(measureTextWidth('Home', bodyFontFace.normal, 16)).toBeCloseTo(44.83, 2);
        expect(measureTextWidth('Recipes', bodyFontFace.medium, 16)).toBeCloseTo(60.94, 2);
        expect(measureTextWidth('Discover', bodyFontFace.semibold, 16)).toBeCloseTo(68.8, 2);
    });

    it('refuses a face the app does not load', () => {
        expect(() => measureTextWidth('Home', 'Inter_900Black_Unknown', 16)).toThrow(/Inter_900Black_Unknown/u);
        expect(() => measureTextWidth('Home', 'Roboto', 16)).toThrow(/Roboto/u);
    });
});
