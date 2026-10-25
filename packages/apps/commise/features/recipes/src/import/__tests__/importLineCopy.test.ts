/**
 * Unit tests for the import line copy (`importLineCopy.ts`), the words both platforms' line leaves draw: an open line's
 * neutral prompt, a closed open line's need with its option count, what a pick says, and which candidates a line offers.
 */
import { describe, expect, it } from 'vitest';

import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../__fixtures__/importLines.js';
import { candidatesOf, closedNeedOf, openPromptOf, pickTextOf } from '../importLineCopy.js';
import { importMessages } from '../messages.js';

const m = importMessages.en.line;

describe('openPromptOf', () => {
    it.each([
        [makeDefaultLine(), 'Choose the flour you use'],
        [makeNeedsChoiceLine(), m.needsChoicePrompt],
        [makeNoMatchLine(), m.noMatchPrompt],
        [makeConfidentLine(), undefined],
    ])('%#: %s', (line, prompt) => {
        expect(openPromptOf(line, m)).toBe(prompt);
    });
});

describe('closedNeedOf', () => {
    it('names a default line’s noun and counts its candidates, not the keep row', () => {
        expect(closedNeedOf(makeDefaultLine(), m, 'en')).toBe('Choose the flour you use · 3 options');
    });

    it('counts in the singular for one candidate', () => {
        expect(
            closedNeedOf(makeNeedsChoiceLine({ candidates: [{ id: 'x', name: 'X', isDefault: false }] }), m, 'en'),
        ).toBe('Choose a food · 1 option');
    });

    it('says a no-match line needs search or keeping', () => {
        expect(closedNeedOf(makeNoMatchLine(), m, 'en')).toBe(m.closedNoMatch);
    });

    it('is undefined for a line that needs nothing', () => {
        expect(closedNeedOf(makeConfidentLine(), m, 'en')).toBeUndefined();
        expect(closedNeedOf(makeCheckingLine(), m, 'en')).toBeUndefined();
    });
});

describe('pickTextOf', () => {
    it('is the food’s name, or “Kept as written”', () => {
        expect(pickTextOf({ kind: 'food', foodId: 'f', name: 'Cake flour' }, m)).toBe('Cake flour');
        expect(pickTextOf({ kind: 'asWritten' }, m)).toBe(m.keptAsWritten);
    });
});

describe('candidatesOf', () => {
    it('is the line’s candidates, and none for a no-match line', () => {
        expect(candidatesOf(makeDefaultLine())).toHaveLength(3);
        expect(candidatesOf(makeNoMatchLine())).toEqual([]);
    });
});
