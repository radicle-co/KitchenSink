import { describe, it, expect } from 'vitest';

import { isModifiedClick } from '../isModifiedClick.js';

const click = (
    overrides: Partial<Parameters<typeof isModifiedClick>[0]> = {},
): Parameters<typeof isModifiedClick>[0] => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
});

describe('isModifiedClick', () => {
    it('is false for a primary click with no modifier: the app’s router owns it', () => {
        expect(isModifiedClick(click())).toBe(false);
    });

    it.each([{ button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
        'is true for %o: the browser owns it (new tab, new window, other button)',
        (overrides) => {
            expect(isModifiedClick(click(overrides))).toBe(true);
        },
    );
});
