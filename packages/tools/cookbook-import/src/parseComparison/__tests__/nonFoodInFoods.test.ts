import { describe, expect, it } from 'vitest';

import { NON_FOOD_KINDS, classifyFoodName, nonFoodsIn } from '../nonFoodInFoods.js';
import type { VariantParse } from '../parseResponse.js';

/**
 * The headline metric of the prompt bake-off, and the mutation lens applied to it.
 *
 * Every case below is chosen so that it would FAIL under a plausible wrong implementation:
 *
 *  - a word-ANYWHERE vessel scan (rather than the lexicon's head-final rule) would call `pot roast` and
 *    `pan gravy` vessels, and the headline would count real foods as the defect it is measuring;
 *  - a shared bucket for vessels and durations would make a `units`-slot arm and an `equipment`-slot arm
 *    indistinguishable, which is exactly the attribution this experiment exists to make;
 *  - a raw-string pronoun set would miss `ones`, which the ranking singularizer folds to `one`;
 *  - counting a blank name would let a model that emitted `{"name":""}` score as if it had filed a vessel.
 */
function parse(names: readonly string[]): VariantParse {
    return { measure: '', foods: names.map((name) => ({ name, prep: null })) };
}

describe('classifyFoodName', () => {
    describe('vessels — the kind the equipment drain is aimed at', () => {
        it('names the vessel the owner observed the shipped prompt filing under foods', () => {
            expect(classifyFoodName('mixing bowl')).toBe('vessel');
        });

        it.each(['a large frying-pan', 'the kettle', 'a hair sieve', 'a colander', 'a spider', 'earthen bowl'])(
            'names %s a vessel',
            (name) => {
                expect(classifyFoodName(name)).toBe('vessel');
            },
        );

        it('is HEAD-FINAL, so a food whose name merely contains a vessel word is a food', () => {
            // ⛔ The anti-regression that makes this metric usable at all. A word-anywhere scan would count
            // all three as non-foods and report a defect rate made mostly of real ingredients.
            expect(classifyFoodName('pot roast')).toBeUndefined();
            expect(classifyFoodName('pan gravy')).toBeUndefined();
            expect(classifyFoodName('a dish of stewed prunes')).toBeUndefined();
        });
    });

    describe('non-substance measures — durations, dimensions, people', () => {
        it.each(['five minutes', 'twenty minutes', 'one hour', 'three times', 'six persons', 'a quarter inch'])(
            'names %s a non-substance measure',
            (name) => {
                expect(classifyFoodName(name)).toBe('nonSubstanceMeasure');
            },
        );

        it('is a DIFFERENT kind from a vessel, because a different prompt slot would fix it', () => {
            expect(classifyFoodName('five minutes')).not.toBe(classifyFoodName('mixing bowl'));
        });
    });

    describe('pronouns — the shape ADR-0026 records as still OPEN', () => {
        it.each(['one', 'it', 'them', 'they', 'these', 'those'])('names %s a pronoun', (name) => {
            expect(classifyFoodName(name)).toBe('pronoun');
        });

        it('folds the INPUT, so a plural spelling the set does not list is still caught', () => {
            // ⚠️ `ones` is deliberately NOT in the set — it singularizes onto `one` under `rankingTokens`.
            // This case is the only evidence that the input side is folded at all.
            expect(classifyFoodName('ones')).toBe('pronoun');
        });

        it('folds the SET, so an entry whose fold differs from its spelling is still matched', () => {
            // ⛔ `this` folds to `thi`. Comparing a folded input against a RAW set answers no here, silently,
            // in the direction that matters: a pronoun reported as a food. Mutation-checked — replacing
            // `new Set(PRONOUNS.map(normalizeName))` with `new Set(PRONOUNS)` fails exactly this assertion.
            expect(classifyFoodName('this')).toBe('pronoun');
        });

        it('does not fire on a food whose name merely ENDS in a pronoun-like word', () => {
            expect(classifyFoodName('one egg')).toBeUndefined();
            expect(classifyFoodName('spring onions')).toBeUndefined();
        });
    });

    describe('foods', () => {
        it.each(['flour', 'brown sugar', 'sweet butter', 'boiling water', 'two eggs', 'poultry fat'])(
            'refuses to call %s a non-food',
            (name) => {
                expect(classifyFoodName(name)).toBeUndefined();
            },
        );
    });

    it('treats a blank name as an ABSENT food rather than a non-food one', () => {
        expect(classifyFoodName('')).toBeUndefined();
        expect(classifyFoodName('   ')).toBeUndefined();
    });

    it('can only ever answer with a kind the census knows about', () => {
        const answers = ['mixing bowl', 'five minutes', 'one', 'flour'].map(classifyFoodName);

        for (const answer of answers) {
            expect(answer === undefined || NON_FOOD_KINDS.includes(answer)).toBe(true);
        }
    });
});

describe('nonFoodsIn', () => {
    it('reports ONE ENTRY PER OFFENDING FOOD, not a boolean, so two vessels are two', () => {
        expect(nonFoodsIn(parse(['mixing bowl', 'a large kettle', 'flour']))).toEqual(['vessel', 'vessel']);
    });

    it('reports the owner-observed failure exactly: the vessel beside the real food', () => {
        // The measured shipped-prompt answer to `a large mixing bowl whip to a cream two eggs`.
        expect(nonFoodsIn(parse(['mixing bowl', 'two eggs']))).toEqual(['vessel']);
    });

    it('is empty when every entry names a food', () => {
        expect(nonFoodsIn(parse(['flour', 'brown sugar']))).toEqual([]);
    });

    it('is empty for a reading that named no food at all', () => {
        expect(nonFoodsIn(parse([]))).toEqual([]);
    });

    it('keeps the kinds apart within one line', () => {
        expect(nonFoodsIn(parse(['mixing bowl', 'five minutes', 'them']))).toEqual([
            'vessel',
            'nonSubstanceMeasure',
            'pronoun',
        ]);
    });
});
