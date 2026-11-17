/**
 * `oneReading`, the one constructor of a `one` reading: whole seconds, and a high end only when it is above the low end
 * once both are rounded.
 */
import { describe, expect, it } from 'vitest';

import { oneReading } from '../durationReading.js';

describe('oneReading', () => {
    it('rounds the seconds to a whole number', () => {
        expect(oneReading(79.8)).toStrictEqual({ kind: 'one', seconds: 80 });
    });

    it('keeps a high end that is above the low end, both rounded', () => {
        expect(oneReading(1_200.4, 1_500.6)).toStrictEqual({ kind: 'one', seconds: 1_200, highSeconds: 1_501 });
    });

    it('drops a high end that is equal to the low end once rounded, though it was above before', () => {
        expect(oneReading(1_200.6, 1_201.4)).toStrictEqual({ kind: 'one', seconds: 1_201 });
    });

    it('drops a reversed high end and never swaps it', () => {
        expect(oneReading(900, 600)).toStrictEqual({ kind: 'one', seconds: 900 });
    });
});
