/**
 * Unit tests for `pasteOpenChoices.ts`: what the publish sheet is told about the paste's lines that have no food yet
 * (R23, `ingredientMatching.md` "Save"). Written from `openChoicesCopy.ts`'s contract and the ruling that publishing with
 * open choices is allowed, seen red first.
 *
 * Rules pinned: the sheet is asked for ONLY while a line needs a pick (a checking line alone is not a reason to stop the
 * cook: `OpenChoicesFacts.openNames` requires at least one name, and the sheet would read "0 ingredients"); the open names
 * are the cook's own food words, in recipe order; checking lines are named apart; and "counted" is the lines that will
 * count toward nutrition: every line but the paste's lines that hold no food.
 */
import { describe, expect, it } from 'vitest';

import type { LineBinding, MatchLine } from '../../ingredientMatching/matchLine.js';
import { openChoiceFactsOf } from '../pasteOpenChoices.js';

const line = (key: string, words: string) => ({ key, line: { measure: '2 cups', words } });
const FOOD: LineBinding = { boundBy: 'server', pick: { kind: 'food', foodId: 'f', name: 'Food' } };
const AS_WRITTEN: LineBinding = { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined };

const needsChoice = (key: string, words: string, binding?: LineBinding): MatchLine => ({
    ...line(key, words),
    state: 'needsChoice',
    candidates: [],
    binding,
});
const checking = (key: string, words: string): MatchLine => ({
    ...line(key, words),
    state: 'checking',
    proposal: words,
    binding: undefined,
});
const confident = (key: string, words: string): MatchLine => ({
    ...line(key, words),
    state: 'confident',
    candidates: [],
    binding: FOOD,
});

describe('openChoiceFactsOf', () => {
    it('⛔ asks for nothing when no line needs a pick', () => {
        expect(openChoiceFactsOf([confident('a', 'flour')], 5)).toBeUndefined();
        expect(openChoiceFactsOf([], 5)).toBeUndefined();
    });

    it('⛔ asks for nothing when lines are only being checked: the sheet could name no open line', () => {
        expect(openChoiceFactsOf([checking('a', 'cream'), confident('b', 'eggs')], 4)).toBeUndefined();
    });

    it('names the lines that need a pick, in recipe order, by the cook’s own words', () => {
        const facts = openChoiceFactsOf(
            [needsChoice('a', 'bread'), confident('b', 'eggs'), needsChoice('c', 'milk'), checking('d', 'cream')],
            9,
        );

        expect(facts?.openNames).toEqual(['bread', 'milk']);
        expect(facts?.checkingNames).toEqual(['cream']);
    });

    it('a line the cook picked for is not open', () => {
        const facts = openChoiceFactsOf([needsChoice('a', 'bread', FOOD), needsChoice('b', 'milk')], 2);

        expect(facts?.openNames).toEqual(['milk']);
    });

    it('counts every draft line but the paste’s lines that hold no food, and totals the draft', () => {
        const lines = [
            needsChoice('a', 'bread'),
            needsChoice('b', 'milk', AS_WRITTEN),
            checking('c', 'cream'),
            confident('d', 'eggs'),
        ];

        // 9 lines in the draft; 3 of the paste's hold no food (bread open, milk kept as written, cream unchecked).
        expect(openChoiceFactsOf(lines, 9)).toMatchObject({ counted: 6, total: 9 });
    });
});
