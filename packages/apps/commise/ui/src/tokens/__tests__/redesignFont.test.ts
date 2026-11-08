/**
 * The redesign's title font: Manrope (SIL OFL 1.1) sets the display role, web and native; Playfair Display is gone.
 * Inter stays for everything else. Pinned to the design session's sources (`__fixtures__/redesignValues.ts`):
 * `--font-display` of tokens.css, and `fontWeight.bold` and `displayFontFace` of nativeTheme.json.
 *
 * The source names the native face just `Manrope`, which is the canvas's CSS family name, not a name `expo-font`
 * registers: `@expo-google-fonts/manrope` registers `Manrope_600SemiBold`, so that is the face native names. The weight
 * ceiling is 600 (the source's `fontWeight.bold`), so the `bold` step maps onto the 600 face in BOTH families and
 * no 700 face is loaded.
 *
 * Mutation lens: restore a Playfair stack or face and the display rows fail; point `bold` back at a 700 face and the
 * weight row fails.
 */
import { describe, expect, it } from 'vitest';

import { bodyFontFace, displayFontFace, fontFamily, fontWeight } from '../scale.js';
import { themeCss } from '../themeCss.js';
import { NATIVE, WEB_LIGHT } from '../__fixtures__/redesignValues.js';

/** Single quotes, lower case, `, ` closed up: the one spelling both sides compare in. */
const norm = (value: string): string =>
    value
        .replace(/"/g, "'")
        .replace(/\s*,\s*/g, ',')
        .toLowerCase();

describe('the display font is Manrope', () => {
    it('sets the web display stack to the source --font-display', () => {
        expect(norm(fontFamily.display)).toBe(norm(WEB_LIGHT['font-display'] ?? ''));
        expect(themeCss()).toContain(`--font-display: ${fontFamily.display};`);
    });

    it('registers Manrope 600 for both display steps on native', () => {
        expect(displayFontFace).toEqual({ semibold: 'Manrope_600SemiBold', bold: 'Manrope_600SemiBold' });
        expect(Object.values(NATIVE['displayFontFace'] ?? {})).toEqual(['Manrope', 'Manrope']);
    });
});

describe('the weight ceiling is 600', () => {
    it('makes the bold step 600 (nativeTheme.json fontWeight.bold)', () => {
        expect(fontWeight.bold).toBe(Number(NATIVE['fontWeight']?.['bold']));
        expect(themeCss()).toContain('--font-weight-bold: 600;');
    });

    it('maps the bold step of the body family onto its 600 face, so no 700 face is named', () => {
        expect(bodyFontFace.bold).toBe('Inter_600SemiBold');
        expect(Object.values({ ...bodyFontFace, ...displayFontFace }).join(' ')).not.toMatch(/700/u);
    });
});
