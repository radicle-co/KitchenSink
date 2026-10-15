import { describe, it, expect } from 'vitest';

import { isPlainClick } from '../isPlainClick.js';

const click = (overrides: Partial<Parameters<typeof isPlainClick>[0]> = {}): Parameters<typeof isPlainClick>[0] => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
});

describe('isPlainClick', () => {
    it('accepts a primary click with no modifier', () => {
        expect(isPlainClick(click())).toBe(true);
    });

    it.each([{ button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
        'leaves %o to the browser (new tab, new window, other button)',
        (overrides) => {
            expect(isPlainClick(click(overrides))).toBe(false);
        },
    );
});
