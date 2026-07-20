/**
 * Unit tests for {@link deriveDisplayName} (W8-a.2 / decision 6) — the ONE display-name rule shared by the
 * identity service and the recipe write-time handle fallback. Pins the join/trim/skip-blank behaviour
 * mutation-resistantly so the two services can never diverge.
 */
import { describe, it, expect } from 'vitest';

import { deriveDisplayName } from '../display-name.js';

describe('deriveDisplayName', () => {
    it('joins first + last with a single space', () => {
        expect(deriveDisplayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    });

    it('uses just the present part when one is missing', () => {
        expect(deriveDisplayName({ firstName: 'Ada' })).toBe('Ada');
        expect(deriveDisplayName({ lastName: 'Lovelace' })).toBe('Lovelace');
    });

    it('trims each part and skips a blank one (no leading/trailing/double spaces)', () => {
        expect(deriveDisplayName({ firstName: '  Ada  ', lastName: '  ' })).toBe('Ada');
        expect(deriveDisplayName({ firstName: ' Ada ', lastName: ' Lovelace ' })).toBe('Ada Lovelace');
    });

    it('returns an empty string when nothing is derivable', () => {
        expect(deriveDisplayName({})).toBe('');
        expect(deriveDisplayName({ firstName: '   ' })).toBe('');
    });
});
