import { describe, expect, it } from 'vitest';

import { ENTER_DURATION_MS, ENTER_RISE_PX, enterMotionMode } from '../enterMotion.js';

/**
 * The enter-motion decision is exhaustively provable: three inputs, three modes. The `pending` case is the
 * load-bearing one — defaulting an unread preference to "motion allowed" is exactly how a reduce-motion gate
 * leaks a half-played animation, so it gets its own assertion rather than being folded into `animate`.
 */
describe('enterMotionMode', () => {
    it('waits while the OS preference is still unknown (never guesses "motion allowed")', () => {
        expect(enterMotionMode({ reduceMotion: undefined })).toBe('pending');
    });

    it('animates when motion is allowed', () => {
        expect(enterMotionMode({ reduceMotion: false })).toBe('animate');
    });

    it('suppresses the motion entirely under reduce-motion', () => {
        expect(enterMotionMode({ reduceMotion: true })).toBe('instant');
    });
});

describe('enter-motion constants', () => {
    it('matches the web keyframe: a 400ms enter rising 8px (0.5rem)', () => {
        // Single-sourced with `--animate-section-enter` in the web app's globals.css, so the two platforms
        // cannot drift on the pace or the distance of the same brand gesture.
        expect(ENTER_DURATION_MS).toBe(400);
        expect(ENTER_RISE_PX).toBe(8);
    });
});
