/**
 * `oneReading`, the one constructor of a `one` reading: whole seconds, and a high end only when it is above the low end
 * once both are rounded.
 */
import { describe, expect, it } from 'vitest';

import { oneReading } from '../durationReading.js';

const SPAN = { start: 4, end: 11 };

describe('oneReading', () => {
    it('rounds the seconds to a whole number', () => {
        expect(oneReading(79.8, undefined, SPAN)).toStrictEqual({ kind: 'one', seconds: 80, span: SPAN });
    });

    it('keeps a high end that is above the low end, both rounded', () => {
        expect(oneReading(1_200.4, 1_500.6, SPAN)).toStrictEqual({
            kind: 'one',
            seconds: 1_200,
            highSeconds: 1_501,
            span: SPAN,
        });
    });

    it('drops a high end that is equal to the low end once rounded, though it was above before', () => {
        expect(oneReading(1_200.6, 1_201.4, SPAN)).toStrictEqual({ kind: 'one', seconds: 1_201, span: SPAN });
    });

    it('drops a reversed high end and never swaps it', () => {
        expect(oneReading(900, 600, SPAN)).toStrictEqual({ kind: 'one', seconds: 900, span: SPAN });
    });
});
