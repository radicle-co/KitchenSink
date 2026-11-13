import { describe, expect, it } from 'vitest';

import {
    CHECK_BOX_MIN_SIDE,
    CHECK_MARK_ANIMATION,
    GLYPH_CORNER_PER_SIDE,
    checkBoxSideOf,
    checkMarkMotion,
} from '../props.js';

/**
 * The box's size at 1x follows the text it labels: `max(18, round_even(roleSize × 0.8))`. So every role of 14, 16 or
 * 18 px keeps today's 18 px box, and a 28 px line gets 22. Mutation lens: drop the floor and a 16 px row draws a 12 px
 * box; round to the nearest integer instead of the nearest even one and a 28 px line draws 23.
 */
describe('checkBoxSideOf', () => {
    it('keeps the 18 px box beside every role of 14, 16 or 18 px', () => {
        for (const role of ['meta', 'list', 'label', 'caption', 'body', 'cardTitle', 'barTitle'] as const) {
            expect(checkBoxSideOf(role), role).toBe(18);
        }

        for (const role of ['readingBody', 'sectionTitle', 'figureStat'] as const) {
            expect(checkBoxSideOf(role), role).toBe(18);
        }
    });

    it('grows to 22 beside a 28 px role', () => {
        expect(checkBoxSideOf('largeTitle')).toBe(22);
    });

    it('defaults to the body role', () => {
        expect(checkBoxSideOf()).toBe(checkBoxSideOf('body'));
    });

    it('never draws under the 18 px floor', () => {
        expect(CHECK_BOX_MIN_SIDE).toBe(18);
    });

    it('keeps the corner at 4/18 of the side', () => {
        expect(GLYPH_CORNER_PER_SIDE).toBe(4 / 18);
        expect(18 * GLYPH_CORNER_PER_SIDE).toBe(4);
    });
});

/**
 * The native check mark's entrance (§1.9): the named spring from 0.9 of its size only when the OS has said motion is
 * allowed. Under reduced motion, and while the preference is still being read, the mark gets no animation props at all.
 */
describe('checkMarkMotion', () => {
    it('springs in from 0.9 of the size it lands on when motion is allowed', () => {
        expect(CHECK_MARK_ANIMATION).toBe('check');
        expect(checkMarkMotion(false, 1)).toEqual({ animation: 'check', enterStyle: { scale: 0.9 } });
        expect(checkMarkMotion(false, 2)).toEqual({ animation: 'check', enterStyle: { scale: 1.8 } });
    });

    it('sets no animation under reduced motion or while the preference is unknown', () => {
        expect(checkMarkMotion(true, 2)).toEqual({});
        expect(checkMarkMotion(undefined, 2)).toEqual({});
    });
});
