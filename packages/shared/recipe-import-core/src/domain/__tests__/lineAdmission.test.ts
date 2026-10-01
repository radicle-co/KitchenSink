/**
 * `readsAsInstruction` — whether a pasted line is a cooking instruction the parse leg should never be asked about
 * (plan 001 §5, option 3). The rule is CLOSED-WORLD: the line opens with an imperative cooking verb, and every other
 * word is one this package knows names no food (a function word, an adverb, a method adjective, a vessel or a
 * no-substance measure) or has every letter inside a quantity phrase. Any other word, which is how a food appears,
 * lets the line through. Words are read with the not-a-food lexicon's own fold, so a hyphenated word is one word.
 *
 * ⚠️ Why closed-world (measured 2026-09-30): a verb-first rule with no quantity skipped 25 labelled NYT ingredient
 * lines (`Add salt to taste`, `Sprinkle of sugar`, `Season with salt and pepper`) and many 1919 clauses that are the
 * book's only statement of a food (`add a carrot`, `Boil a few potatoes`, `cut up an onion`).
 *
 * ⛔ Two errors, not equal. A false refusal never parses a real ingredient, so the rule is conservative: every case
 * in the "reaches the parser" table is a line a cook could paste into an ingredient list. A false admission is
 * today's behaviour.
 */
import { describe, expect, it } from 'vitest';

import { readsAsInstruction } from '../lineAdmission.js';

describe('readsAsInstruction', () => {
    it.each([
        ['a 1919 method clause', 'Put on a platter.'],
        ['another', 'put in a bowl'],
        ['a third', 'Set in a cool place'],
        ['a bare imperative', 'Mix well'],
        ['a duration', 'Bake 25 minutes'],
        ['a written-out duration', 'Boil two hours'],
        ['a temperature', 'Preheat the oven to 350 degrees'],
        ['a duration after the verb phrase', 'Stir constantly for five minutes'],
        ['a range of minutes', 'Simmer for 5 to 7 minutes'],
        ['a knife measure', 'Roll out to one-half inch thick'],
        ['upper case', 'SERVE HOT'],
        ['adjectives before a vessel', 'Bake in a quick hot oven one-half hour'],
        ['a verb as the object', 'bring to a boil'],
        ['a pronoun object', 'Turn this mixture out on a flat dish'],
    ])('reads %s as an instruction: %s', (_, line) => {
        expect(readsAsInstruction(line)).toBe(true);
    });

    it.each([
        ['a measured ingredient', '2 cups flour'],
        ['a food-word consistency, which the parser may read', 'Rub to a cream.'],
        ['NYT: a seasoning line led by add', 'Add salt to taste'],
        ['NYT: a noun sprinkle', 'Sprinkle of sugar'],
        ['NYT: a noun grease', 'Grease and flour for pan'],
        ['NYT: a seasoning line led by season', 'Season with salt and pepper'],
        ['NYT: a serving suggestion', 'serve with rice'],
        ['NYT: a fried ingredient', 'Fry bacon slices'],
        ['1919: a food introduced by add', 'add a carrot'],
        ['1919: a food introduced by boil', 'Boil a few potatoes'],
        ['1919: a food introduced by cut', 'cut up an onion'],
        ['1919: a food introduced by sprinkle', 'sprinkle a little salt'],
        ['1919: a food introduced by soak', 'Soak some bread'],
        ['1919: a food in a method phrase', 'Heat some butter in a spider'],
        ['a 1919 homograph ingredient', 'Butter, size of an egg'],
        ['a modern seasoning line', 'Salt and pepper to taste'],
        ['a greasing line', 'Butter, for greasing'],
        ['a cream line', 'Cream, whipped'],
        ['a dusting line', 'Flour for dusting'],
        ['a garnish heading', 'Garnish: fresh parsley'],
        ['a food glued to its number', 'Beat 2eggs'],
        ['a food glued to a bracketed number', 'Add (2)eggs'],
        ['a food hyphenated to a written number', 'Beat two-eggs'],
        ['a food glued to a two-digit number', 'Beat 12yolks'],
        ['a one-letter unit glued to its number, the letter just past the phrase', 'Add 2T'],
        ['a juice line', 'Juice of one lemon'],
        ['a brown sugar line', 'Brown sugar, packed'],
        ['a method line that names a quantity of food', 'Beat 2 eggs'],
        ['another', 'Add one cup of milk'],
        ['an article that is a quantity, because a unit follows', 'Add a cup of milk'],
        ['an article before a subjective unit', 'Add a pinch of salt'],
        ['a range of a food', 'Beat 2 or 3 eggs'],
        ['a bulleted line, which this rule leaves to the parser', '- Mix well'],
        ['a numbered step, which this rule leaves to the parser', '1. Mix well'],
        ['a noun-led ingredient', 'Eggs, beaten'],
        ['a participle-led ingredient', 'Chopped parsley'],
        ['an empty line', ''],
        ['a blank line', '   '],
    ])('lets %s reach the parser: %s', (_, line) => {
        expect(readsAsInstruction(line)).toBe(false);
    });

    it('needs the verb FIRST, so a verb later in an ingredient line changes nothing', () => {
        expect(readsAsInstruction('Butter, then stir')).toBe(false);
        expect(readsAsInstruction('then stir well')).toBe(false);
        expect(readsAsInstruction('stir well')).toBe(true);
    });

    it('lets any unknown word through, since an unknown word is how a food appears', () => {
        expect(readsAsInstruction('Stir in the butter')).toBe(false);
        expect(readsAsInstruction('Stir in the oven')).toBe(true);
    });

    it('reads a hyphenated word whole, with the lexicon`s own fold', () => {
        // `frying` alone is unknown; the lexicon keys the vessel `frying-pan` whole.
        expect(readsAsInstruction('Grease a frying-pan.')).toBe(true);
        // The same fold makes `well-done` one unknown word rather than two known ones, so this line passes.
        expect(readsAsInstruction('Cook until well-done')).toBe(false);
    });

    it('gives a word to a quantity phrase only when every letter of it lies inside the phrase', () => {
        // The bracket sits outside `four and a half`, but every letter of `(four` is inside it.
        expect(readsAsInstruction('Place in greased pans (four and a half by nine inches)')).toBe(true);
        // `eggs` lies outside the phrase `2`, so the word is judged, and a food lets the line through.
        expect(readsAsInstruction('Beat 2eggs')).toBe(false);
    });

    it('reads no number and no punctuation as a word', () => {
        expect(readsAsInstruction('Bake 25 minutes.')).toBe(true);
        expect(readsAsInstruction('Stir — gently.')).toBe(true);
        expect(readsAsInstruction('Stir, then bake')).toBe(true);
    });
});
