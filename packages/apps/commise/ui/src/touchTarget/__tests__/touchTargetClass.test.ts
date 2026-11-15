import { describe, expect, it } from 'vitest';

import { TOUCH_DISC_SIZE_CLASS } from '../touchTargetClass.js';

describe('TOUCH_DISC_SIZE_CLASS', () => {
    it('is a fixed 44 CSS px square, written in px so it does not grow with the root text size', () => {
        expect(TOUCH_DISC_SIZE_CLASS).toBe('size-[44px]');
    });
});
