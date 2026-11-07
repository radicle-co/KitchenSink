import { bodyFontFace, displayFontFace, fontWeight } from '@commise/ui/scale';
import { describe, expect, it } from 'vitest';

import { fontFaces } from '../fontFaces.js';

describe('fontFaces', () => {
    const faces = fontFaces();

    it('registers each native face twice: under its family at its weight, and under its own name at 400', () => {
        const natives = new Set([...Object.values(bodyFontFace), ...Object.values(displayFontFace)]);

        expect(faces).toHaveLength(2 * natives.size);

        for (const native of natives) {
            const registrations = faces.filter((face) => face.fileName === `${native}.ttf`);

            expect(registrations.map((face) => face.family).sort()).toEqual(
                [native, native.startsWith('Inter') ? 'Inter' : 'Manrope'].sort(),
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

            expect(faces.find((face) => face.family === 'Manrope' && face.fileName === `${native}.ttf`)?.weight).toBe(
                weight,
            );
        }
    });

    it('points each face at its directory inside the font package', () => {
        const inter = faces.find((face) => face.fileName === 'Inter_600SemiBold.ttf');
        const manrope = faces.find((face) => face.fileName === 'Manrope_600SemiBold.ttf');

        expect(inter?.specifier).toBe('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf');
        expect(manrope?.specifier).toBe('@expo-google-fonts/manrope/600SemiBold/Manrope_600SemiBold.ttf');
    });
});
