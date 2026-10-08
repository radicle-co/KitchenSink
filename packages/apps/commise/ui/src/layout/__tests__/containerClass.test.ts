/**
 * The container and viewport classes (`docs/design/uiOverhaul/buildSpec.md` §1.2), as pure functions over a width.
 *
 * Content responds to the width it actually gets (`<main>`'s content box on web, the window minus its gutters on
 * native), never to the viewport; the viewport class decides only the shell and the gutter. Both thresholds are a
 * `>=` at the boundary pixel, matching CSS `(width >= …)`, so the boundary rows are what this suite exists for.
 *
 * Mutation lens: flip a `>=` to `>`, or read the viewport thresholds for the container ones, and a boundary row fails.
 */
import { describe, expect, it } from 'vitest';

import { containerClassOf, contentWidthOf, gutterOf, viewportClassOf } from '../containerClass.js';

describe('containerClassOf', () => {
    it.each([
        [0, 'narrow'],
        [599, 'narrow'],
        [600, 'regular'],
        [959, 'regular'],
        [960, 'wide'],
        [1600, 'wide'],
    ] as const)('%i px of content is %s', (px, expected) => {
        expect(containerClassOf(px)).toBe(expected);
    });
});

describe('viewportClassOf', () => {
    it.each([
        [320, 'compact'],
        [599, 'compact'],
        [600, 'medium'],
        [839, 'medium'],
        [840, 'expanded'],
        [1920, 'expanded'],
    ] as const)('a %i px window is %s', (px, expected) => {
        expect(viewportClassOf(px)).toBe(expected);
    });
});

describe('gutterOf', () => {
    it.each([
        [390, 16],
        [600, 24],
        [839, 24],
        [840, 32],
    ] as const)('a %i px window has %i px gutters', (px, expected) => {
        expect(gutterOf(px)).toBe(expected);
    });
});

// §1.2's native rows: "native phone 358–398" is a 390–430 window less two 16 px gutters.
describe('contentWidthOf (native: the window less its gutters)', () => {
    it.each([
        [390, 358],
        [430, 398],
        [744, 696],
        [1024, 960],
    ] as const)('a %i px window leaves %i px of content', (px, expected) => {
        expect(contentWidthOf(px)).toBe(expected);
    });

    it('never goes below zero', () => {
        expect(contentWidthOf(10)).toBe(0);
    });
});
