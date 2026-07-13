/**
 * Unit tests for the recipe-detail model layer — the pure helpers the web and native detail views share.
 */
import { describe, expect, it } from 'vitest';

import { formatQuantity } from '../model.js';

describe('formatQuantity', () => {
    it('joins a quantity and unit', () => {
        expect(formatQuantity(2, 'tbsp')).toBe('2 tbsp');
    });

    it('preserves fractional quantities', () => {
        expect(formatQuantity(1.5, 'lbs')).toBe('1.5 lbs');
    });

    it('omits the unit when absent', () => {
        expect(formatQuantity(3, undefined)).toBe('3');
    });

    it('treats an empty-string unit as no unit', () => {
        expect(formatQuantity(3, '')).toBe('3');
    });
});
