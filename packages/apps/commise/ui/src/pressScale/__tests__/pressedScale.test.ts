import { describe, expect, it } from 'vitest';

import { PRESS_SCALE, pressedScale } from '../pressedScale.js';

/**
 * pressedScale — the pure branch behind the native PressScale's `transform` scale. Testing it directly
 * proves the reduce-motion suppression (and the disabled/not-pressed neutrals) deterministically, with no
 * renderer and no animation timing — the mutation-resistant proof the primitive's behaviour rests on.
 */
describe('pressedScale', () => {
    it('shrinks to the press scale only while actively held', () => {
        expect(pressedScale({ pressed: true, disabled: false, reduceMotion: false })).toBe(PRESS_SCALE);
    });

    it('stays neutral (1) when not pressed', () => {
        expect(pressedScale({ pressed: false, disabled: false, reduceMotion: false })).toBe(1);
    });

    it('gives no feedback when disabled, even while pressed', () => {
        expect(pressedScale({ pressed: true, disabled: true, reduceMotion: false })).toBe(1);
    });

    it('is suppressed under reduce-motion, even while pressed', () => {
        expect(pressedScale({ pressed: true, disabled: false, reduceMotion: true })).toBe(1);
    });

    it('honours an explicit scale override while held', () => {
        expect(pressedScale({ pressed: true, disabled: false, reduceMotion: false, scale: 0.9 })).toBe(0.9);
    });

    it('exposes 0.98 as the canonical design-system press scale', () => {
        expect(PRESS_SCALE).toBe(0.98);
    });
});
