import { describe, expect, it } from 'vitest';

import { stepFrom } from '../props.js';

describe('stepFrom', () => {
    it('steps up and down inside the bounds', () => {
        expect(stepFrom(2, 1, 1, 10)).toBe(3);
        expect(stepFrom(2, -1, 1, 10)).toBe(1);
    });

    it('refuses to step below the minimum', () => {
        expect(stepFrom(1, -1, 1, undefined)).toBeNull();
    });

    it('refuses to step above the maximum, and allows reaching it', () => {
        expect(stepFrom(9, 1, 1, 10)).toBe(10);
        expect(stepFrom(10, 1, 1, 10)).toBeNull();
    });

    it('has no upper bound without a maximum', () => {
        expect(stepFrom(1000, 1, 1, undefined)).toBe(1001);
    });
});
