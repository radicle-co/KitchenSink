/**
 * The words of a method line (plan 001 §5), as two vocabularies: the imperative cooking verbs that can open one, and
 * the other words it can hold that name no food.
 *
 * ⛔ The list is conservative on purpose. A word that also names a food (`cream`, `butter`, `salt`, `brown`,
 * `roast`) opens real ingredient lines (`Butter, size of an egg`, `Brown sugar`), and a false refusal loses an
 * ingredient the cook pasted. Such a word is never a verb here: an instruction it opens still reaches the parser,
 * which is today's behaviour.
 */
import { describe, expect, it } from 'vitest';

import { isImperativeCookingVerb, isMethodWord } from '../instructionLexicon.js';

describe('isImperativeCookingVerb', () => {
    it.each(['add', 'bake', 'beat', 'boil', 'mix', 'put', 'rub', 'serve', 'set', 'stir', 'preheat', 'simmer'])(
        'knows %s',
        (word) => {
            expect(isImperativeCookingVerb(word)).toBe(true);
        },
    );

    it.each([
        'cream',
        'butter',
        'salt',
        'pepper',
        'flour',
        'sugar',
        'oil',
        'brown',
        'roast',
        'toast',
        'stew',
        'mince',
        'juice',
        'zest',
        'pinch',
        'dash',
        'slice',
        'line',
        'garnish',
    ])('never counts %s, a word that also opens an ingredient line', (word) => {
        expect(isImperativeCookingVerb(word)).toBe(false);
    });

    it('folds case, and does not read a participle or an unknown word as the verb', () => {
        expect(isImperativeCookingVerb('Stir')).toBe(true);
        expect(isImperativeCookingVerb('STIR')).toBe(true);
        expect(isImperativeCookingVerb('stirred')).toBe(false);
        expect(isImperativeCookingVerb('chopped')).toBe(false);
        expect(isImperativeCookingVerb('')).toBe(false);
    });
});

describe('isMethodWord', () => {
    it.each(['in', 'the', 'well', 'constantly', 'hot', 'moderate', 'place', 'mixture', 'it', 'them', 'until'])(
        'knows %s',
        (word) => {
            expect(isMethodWord(word)).toBe(true);
        },
    );

    it.each(['cream', 'salt', 'flour', 'bread', 'onion', 'dough', 'batter', 'paste', 'water', 'fat', 'sugar'])(
        'never holds %s, a word that names a food or a mixture of foods',
        (word) => {
            expect(isMethodWord(word)).toBe(false);
        },
    );

    it('folds case', () => {
        expect(isMethodWord('Until')).toBe(true);
    });
});
