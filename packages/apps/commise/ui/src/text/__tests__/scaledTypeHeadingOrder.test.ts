import { describe, expect, it } from 'vitest';

import { typeRole } from '../../tokens/typography.js';
import { scaledTypeSize } from '../scaledType.js';

/**
 * The designer's invariant (qa-ios, 2026-11-03): at the largest text size the page title is never drawn smaller than any
 * other type role, so a heading can never outrank the title of its own screen. `figureInline` has no size of its own and
 * is not a sized role. 3.1 is iOS at AX XXXL, past every role's cap. `readingLarge` is exempt: it is reading
 * text, not a heading, it is never on a screen with `largeTitle`, and it is capped at 2x, so it draws at 56 against the
 * title's 42.
 */
describe('scaledTypeSize — heading order at the cap', () => {
    const IOS_CAP_SCALE = 3.1;
    const sizedRoles = (Object.keys(typeRole) as (keyof typeof typeRole)[]).filter(
        (role): role is Exclude<keyof typeof typeRole, 'figureInline' | 'readingLarge'> =>
            role !== 'figureInline' && role !== 'readingLarge',
    );

    it.each(sizedRoles)('draws largeTitle at least as large as %s', (role) => {
        expect(scaledTypeSize('largeTitle', IOS_CAP_SCALE).fontSize).toBeGreaterThanOrEqual(
            scaledTypeSize(role, IOS_CAP_SCALE).fontSize,
        );
    });

    it.each([1, 1.5, 2, 3.1])('draws readingLarge at least as large as readingBody at system scale %s', (scale) => {
        expect(scaledTypeSize('readingLarge', scale).fontSize).toBeGreaterThanOrEqual(
            scaledTypeSize('readingBody', scale).fontSize,
        );
    });

    it('draws readingLarge at 56 at the iOS cap scale', () => {
        expect(scaledTypeSize('readingLarge', IOS_CAP_SCALE).fontSize).toBe(56);
    });

    it('exempts exactly figureInline and readingLarge from the title invariant', () => {
        const kept = new Set<string>(sizedRoles);
        const exempt = (Object.keys(typeRole) as (keyof typeof typeRole)[]).filter((role) => !kept.has(role));

        expect(exempt.sort()).toEqual(['figureInline', 'readingLarge']);
    });
});
