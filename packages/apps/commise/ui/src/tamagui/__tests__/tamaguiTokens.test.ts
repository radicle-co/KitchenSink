/**
 * The Tamagui tokens are a projection of the design scale (`tokens/scale.ts`). What is pinned here is the projection's
 * shape: there is no colour group (a colour is a theme role, never a palette swatch), radius steps keep their names,
 * and every number is the scale's own.
 */
import { describe, expect, it } from 'vitest';

import { radius, spacing } from '../../tokens/scale.js';
import { tamaguiTokens } from '../tamaguiTokens.js';

describe('tamaguiTokens', () => {
    it('has no colour group, so a raw palette colour cannot be written as a token', () => {
        expect(Object.keys(tamaguiTokens).sort()).toEqual(['radius', 'size', 'space', 'zIndex']);
    });

    it('takes every space and size step from the spacing scale, and has no `true` step', () => {
        expect(tamaguiTokens.space).toEqual(spacing);
        expect(tamaguiTokens.size).toEqual(spacing);
    });

    it('keeps the radius names, with a zero step that is not a reserved CSS keyword', () => {
        expect(tamaguiTokens.radius).toEqual({ 0: 0, ...radius });
    });

    it('has only the zero stacking step until a ported component names another on the scale', () => {
        expect(tamaguiTokens.zIndex).toEqual({ 0: 0 });
    });
});
