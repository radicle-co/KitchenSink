import { describe, expect, it } from 'vitest';

import { animationsUsed, undefinedAnimations } from '../animationsUsed.js';

describe('animationsUsed', () => {
    it.each([
        ['a plain class', 'className="animate-section-enter"', ['section-enter']],
        ['a variant-prefixed class', 'motion-safe:animate-pending-bar-reveal', ['pending-bar-reveal']],
        ['a class in a class list', 'class="a animate-wiggle b"', ['wiggle']],
        ['the same class twice', 'animate-wiggle animate-wiggle', ['wiggle']],
        ['Tailwind’s own animations', 'animate-spin animate-pulse animate-ping animate-bounce animate-none', []],
        ['an arbitrary value', 'animate-[wiggle_1s_ease]', []],
        ['a word that merely contains the prefix', 'inanimate-thing reanimate-x', []],
    ])('finds %s', (_name, source, expected) => {
        expect(animationsUsed(source)).toEqual(expected);
    });
});

/** A stylesheet shaped like the theme's animation tokens, for the pure comparison below. */
const THEME_CSS = `@theme {
    --animate-section-enter: section-enter 400ms ease-out both;
}`;

describe('undefinedAnimations', () => {
    it('is empty when the stylesheet defines every animation used', () => {
        expect(undefinedAnimations(['section-enter'], THEME_CSS)).toEqual([]);
    });

    it('names an animation a source uses and the motion theme lacks', () => {
        expect(undefinedAnimations(['section-enter', 'wiggle'], THEME_CSS)).toEqual(['wiggle']);
    });

    it('does not take a keyframes rule for the Tailwind token', () => {
        expect(undefinedAnimations(['wiggle'], '@keyframes wiggle { from { opacity: 0 } }')).toEqual(['wiggle']);
    });
});
