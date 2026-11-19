import { describe, expect, it } from 'vitest';

import { CHECK_BOX_MIN_SIDE, GLYPH_CORNER_PER_SIDE, checkBoxSideOf } from '../props.js';

/**
 * The box's size at 1x follows the text it labels: `max(18, round_even(roleSize × 0.8))`. So every role of 14, 16 or
 * 18 px keeps today's 18 px box, and a 28 px line gets 22. Mutation lens: drop the floor and a 16 px row draws a 12 px
 * box. Round-to-even cannot be told from plain rounding with today's roles (14, 16, 18 and 28 px: 28 × 0.8 = 22.4
 * gives 22 either way), so no case here pins it.
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
