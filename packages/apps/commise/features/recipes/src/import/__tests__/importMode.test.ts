/**
 * Unit tests for the import mode registry (`importMode.ts`): the three modes in the board's order with their words, and
 * the round trip from a chosen row back to its mode — an id that is not a mode answers `undefined`, never a guess.
 */
import { describe, expect, it } from 'vitest';

import { IMPORT_MATCH_MODES, modeOfOptionId, modeOptionsOf } from '../importMode.js';
import { importMessages } from '../messages.js';

const m = importMessages.en.mode;

describe('modeOptionsOf', () => {
    it('lists the three modes in the board’s order, each with its title and hint, none tagged', () => {
        expect(modeOptionsOf(m)).toEqual([
            { id: 'saveAsWritten', label: m.saveAsWrittenTitle, hint: m.saveAsWrittenHint },
            { id: 'best', label: m.bestTitle, hint: m.bestHint },
            { id: 'review', label: m.reviewTitle, hint: m.reviewHint },
        ]);
    });
});

describe('modeOfOptionId', () => {
    it.each(IMPORT_MATCH_MODES)('round-trips %s', (mode) => {
        expect(modeOfOptionId(mode)).toBe(mode);
    });

    it.each(['', 'keepAsWritten', 'bindBest', 'REVIEW'])('answers undefined for %j', (id) => {
        expect(modeOfOptionId(id)).toBeUndefined();
    });
});
