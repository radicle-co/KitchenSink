import { describe, expect, it } from 'vitest';

import { CHIP_LABEL_LIMIT, visibleChipLabel } from '../chipLabel.js';

describe('visibleChipLabel', () => {
    it('shows a label of up to 24 characters whole', () => {
        expect(visibleChipLabel('Vegan')).toBe('Vegan');
        expect(visibleChipLabel('a'.repeat(CHIP_LABEL_LIMIT))).toBe('a'.repeat(24));
    });

    it('cuts a label of 25 characters to 23 and an ellipsis, so it still shows 24', () => {
        const shown = visibleChipLabel('b'.repeat(25));

        expect(shown).toBe(`${'b'.repeat(23)}…`);
        expect(Array.from(shown)).toHaveLength(24);
    });

    it('counts a character outside the BMP once and never splits it', () => {
        const label = `${'🍋'.repeat(30)}`;
        const shown = visibleChipLabel(label);

        expect(Array.from(shown)).toHaveLength(24);
        expect(shown.startsWith('🍋'.repeat(23))).toBe(true);
    });

    it('shows an empty label as empty', () => {
        expect(visibleChipLabel('')).toBe('');
    });
});
