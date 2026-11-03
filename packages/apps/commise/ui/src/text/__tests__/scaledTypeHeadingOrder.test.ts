import { describe, expect, it } from 'vitest';

import { typeRole } from '../../tokens/typography.js';
import { scaledTypeSize } from '../scaledType.js';

/**
 * The designer's invariant (qa-ios, 2026-11-03): at the largest text size the page title is never drawn smaller than any
 * other type role, so a heading can never outrank the title of its own screen. `figureInline` has no size of its own and
 * is not a sized role. 3.1 is iOS at AX XXXL, past every role's cap.
 */
describe('scaledTypeSize — heading order at the cap', () => {
    const IOS_CAP_SCALE = 3.1;
    const sizedRoles = (Object.keys(typeRole) as (keyof typeof typeRole)[]).filter(
        (role): role is Exclude<keyof typeof typeRole, 'figureInline'> => role !== 'figureInline',
    );

    it.each(sizedRoles)('draws largeTitle at least as large as %s', (role) => {
        expect(scaledTypeSize('largeTitle', IOS_CAP_SCALE).fontSize).toBeGreaterThanOrEqual(
            scaledTypeSize(role, IOS_CAP_SCALE).fontSize,
        );
    });
});
