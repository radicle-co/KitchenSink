/**
 * End-to-end guard for the mobile display-font faces (U8). Three links have to hold, and only the middle one
 * is visible to the type checker:
 *
 *   design scale (`nativeTokens.fontFace.display`) → `theme/fonts.ts` aliases → the faces `App.tsx` LOADS
 *
 * If the last link breaks — a token naming a face nobody registers — React Native falls back to the system
 * serif silently, with no error and no failing type, which is exactly how the Playfair regression this suite
 * exists for shipped. So the app's own `useFonts` registration is read back from source and matched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { nativeTokens } from '@commise/ui/native';

import { DISPLAY_FONT_BOLD, DISPLAY_FONT_SEMIBOLD } from '../../src/theme/fonts.js';

/** `App.tsx` source — the single place the Playfair faces are registered with `expo-font`. */
const appSource = readFileSync(path.resolve(import.meta.dirname, '../../App.tsx'), 'utf8');

/** The face names passed to `useFonts({ … })` at app start. */
function registeredFaces(): readonly string[] {
    const call = /useFonts\(\{([^}]*)\}\)/u.exec(appSource);

    expect(call).not.toBeNull();

    return (call?.[1] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

describe('mobile display-font faces', () => {
    it('aliases the design system registry rather than re-typing face-name literals', () => {
        expect(DISPLAY_FONT_SEMIBOLD).toBe(nativeTokens.fontFace.display.semibold);
        expect(DISPLAY_FONT_BOLD).toBe(nativeTokens.fontFace.display.bold);
    });

    it('names only faces the app actually loads at start-up', () => {
        const faces = registeredFaces();

        // Guard against a vacuous pass if the registration call ever stops being parsed.
        expect(faces.length).toBeGreaterThan(0);
        expect(faces).toContain(DISPLAY_FONT_SEMIBOLD);
        expect(faces).toContain(DISPLAY_FONT_BOLD);
    });

    it('are single registered face names, never a CSS font stack', () => {
        for (const face of [DISPLAY_FONT_SEMIBOLD, DISPLAY_FONT_BOLD]) {
            expect(face).not.toContain(',');
            expect(face).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/u);
        }
    });
});
