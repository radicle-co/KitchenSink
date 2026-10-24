import { palette, role } from '@commise/ui/colors';
import { typeRole } from '@commise/ui/tokens/typography';
import { describe, expect, it } from 'vitest';

import { BRAND_USAGE, ROLE_USAGE, TYPE_ROLE_DOC } from '../tokenUsage.js';

describe('tokenUsage registries', () => {
    it('states a usage for exactly the colour roles @commise/ui has', () => {
        expect(Object.keys(ROLE_USAGE).sort()).toEqual(Object.keys(role).sort());
    });

    it('states a usage for exactly the type roles @commise/ui has', () => {
        expect(Object.keys(TYPE_ROLE_DOC).sort()).toEqual(Object.keys(typeRole).sort());
    });

    it('names only palette tones as brand tones', () => {
        for (const tone of Object.keys(BRAND_USAGE)) {
            expect(tone in palette, tone).toBe(true);
        }
    });

    it('writes every note as a sentence', () => {
        for (const note of [
            ...Object.values(ROLE_USAGE),
            ...Object.values(BRAND_USAGE),
            ...Object.values(TYPE_ROLE_DOC).map((doc) => doc.usage),
        ]) {
            expect(note).toMatch(/^[A-Z].*[.]$/);
        }
    });
});
