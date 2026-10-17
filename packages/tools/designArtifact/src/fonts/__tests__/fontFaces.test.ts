import { bodyFontFace, displayFontFace, fontWeight } from '@commise/ui/scale';
import { describe, expect, it } from 'vitest';

import { fontFaces } from '../fontFaces.js';

describe('fontFaces', () => {
    const faces = fontFaces();

    it('registers each native face twice: under its family at its weight, and under its own name at 400', () => {
        expect(faces).toHaveLength(2 * (Object.keys(bodyFontFace).length + Object.keys(displayFontFace).length));

        for (const native of [...Object.values(bodyFontFace), ...Object.values(displayFontFace)]) {
            const registrations = faces.filter((face) => face.fileName === `${native}.ttf`);

            expect(registrations.map((face) => face.family).sort()).toEqual(
                [native, native.startsWith('Inter') ? 'Inter' : 'Playfair Display'].sort(),
            );
            expect(registrations.find((face) => face.family === native)?.weight).toBe(400);
        }
    });

    it('gives the family registration the weight of the scale step the face belongs to', () => {
        for (const [step, native] of Object.entries(bodyFontFace)) {
            const weight = fontWeight[step as keyof typeof fontWeight];

            expect(faces.find((face) => face.family === 'Inter' && face.fileName === `${native}.ttf`)?.weight).toBe(
                weight,
            );
        }

        for (const [step, native] of Object.entries(displayFontFace)) {
            const weight = fontWeight[step as keyof typeof fontWeight];

            expect(
                faces.find((face) => face.family === 'Playfair Display' && face.fileName === `${native}.ttf`)?.weight,
            ).toBe(weight);
        }
    });

    it('points each face at its directory inside the font package', () => {
        const inter = faces.find((face) => face.fileName === 'Inter_600SemiBold.ttf');
        const playfair = faces.find((face) => face.fileName === 'PlayfairDisplay_700Bold.ttf');

        expect(inter?.specifier).toBe('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf');
        expect(playfair?.specifier).toBe('@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf');
    });
});
