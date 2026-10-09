/**
 * Unit tests for `unitSuggestions.ts` — what the row editor's Unit combobox suggests (build spec §7.5.2): units from
 * recipe-core's own vocabulary that start with what the cook typed. The field still holds any text, so a saved
 * `handful` or a word the vocabulary has never seen stays as typed.
 */
import { describe, expect, it } from 'vitest';

import { SUBJECTIVE_UNIT_VOCABULARY, UNIT_VOCABULARY } from '@kitchensink/recipe-core';

import { UNIT_SUGGESTION_LIMIT, unitSuggestionsOf } from '../unitSuggestions.js';

describe('unitSuggestionsOf', () => {
    it('suggests nothing for an empty field', () => {
        expect(unitSuggestionsOf('   ')).toEqual([]);
    });

    it('suggests the vocabulary units that start with the typed text, case folded', () => {
        const suggestions = unitSuggestionsOf('TaB');

        expect(suggestions).toContain('tablespoon');
        expect(suggestions.every((unit) => unit.toLowerCase().startsWith('tab'))).toBe(true);
    });

    it('draws only from recipe-core’s vocabulary, never a second list', () => {
        const known = new Set([...UNIT_VOCABULARY, ...SUBJECTIVE_UNIT_VOCABULARY]);

        for (const prefix of ['c', 'p', 'g', 't', 'h']) {
            expect(unitSuggestionsOf(prefix).every((unit) => known.has(unit))).toBe(true);
        }
    });

    it(`shows at most ${String(UNIT_SUGGESTION_LIMIT)}`, () => {
        expect(unitSuggestionsOf('c').length).toBeLessThanOrEqual(UNIT_SUGGESTION_LIMIT);
    });

    it('suggests nothing for a word no unit starts with', () => {
        expect(unitSuggestionsOf('blorp')).toEqual([]);
    });
});
