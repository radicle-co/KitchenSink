/**
 * Unit tests for the recipe-detail model layer — the pure helpers the web and native detail views share.
 */
import { describe, expect, it } from 'vitest';

import { formatQuantity } from '../model.js';

describe('formatQuantity', () => {
    it('joins a quantity and unit', () => {
        expect(formatQuantity(2, 'en-US', 'tbsp')).toBe('2 tbsp');
    });

    it('preserves fractional quantities', () => {
        expect(formatQuantity(1.5, 'en-US', 'lbs')).toBe('1.5 lbs');
    });

    it('omits the unit when absent', () => {
        expect(formatQuantity(3, 'en-US', undefined)).toBe('3');
    });

    it('treats an empty-string unit as no unit', () => {
        expect(formatQuantity(3, 'en-US', '')).toBe('3');
    });

    it('locale-groups a large quantity via Intl (never string concatenation)', () => {
        expect(formatQuantity(1000, 'en-US')).toBe('1,000');
    });

    it('formats a fractional quantity with a unit correctly for en-US', () => {
        expect(formatQuantity(2.5, 'en-US', 'cups')).toBe('2.5 cups');
    });
});
