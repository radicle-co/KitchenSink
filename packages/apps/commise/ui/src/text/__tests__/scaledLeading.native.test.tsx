/** `scaledLeading` is the leading before the iOS snap (react/react-native#58970): row maths reads it, a style reads the snap. */
import { describe, expect, it } from 'vitest';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { typeRole } from '../../tokens/typography.js';
import { scaledLeading, scaledTypeSize } from '../scaledType.js';

describe('scaledLeading', () => {
    it('is the raw token at 1x, where the iOS snap lifts the drawn leading above it', () => {
        withPlatformOs('ios', () => {
            expect(scaledLeading('body', 1)).toBe(typeRole.body.lineHeight);
            expect(scaledTypeSize('body', 1).lineHeight).toBeGreaterThan(scaledLeading('body', 1));
        });
    });

    it('grows with the scale up to the role ceiling, like the drawn leading', () => {
        expect(scaledLeading('body', 3.1)).toBe(typeRole.body.lineHeight * 2);
        expect(scaledLeading('largeTitle', 3.1)).toBe(typeRole.largeTitle.lineHeight * 1.5);
    });
});
