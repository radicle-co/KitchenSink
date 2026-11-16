import { describe, expect, it } from 'vitest';

import { MAX_PARSE_JOB_LINES, PARSE_JOB_LINE_MAX_CHARS } from '../../parsing/parseJobText.js';
import { acceptRecipe } from '../recipeAcceptance.js';
import type { PageRecipe } from '../pageRecipeCandidate.js';

/** A recipe that passes every predicate; each test breaks exactly one. */
function recipeOf(overrides: Partial<PageRecipe> = {}): PageRecipe {
    return {
        title: 'Test Pancakes',
        ingredientLines: ['1 cup flour', '2 eggs'],
        steps: [{ instruction: 'Mix the batter.' }, { instruction: 'Cook in a hot pan.' }],
        ...overrides,
    };
}

const stepsOf = (...texts: string[]) => texts.map((instruction) => ({ instruction }));

describe('acceptRecipe: the black-and-white gate, one case per predicate and both sides of its threshold', () => {
    it('accepts a recipe that breaks no predicate, for every tier', () => {
        expect(acceptRecipe(recipeOf(), 'jsonLd')).toEqual({ ok: true });
        expect(acceptRecipe(recipeOf(), 'microdata')).toEqual({ ok: true });
    });

    describe('G1: the title passes recipeTitleSchema', () => {
        it.each([
            ['an empty title', '', false],
            ['a 200-character title', 'x'.repeat(200), true],
            ['a 201-character title', 'x'.repeat(201), false],
        ])('%s', (_label, title, ok) => {
            expect(acceptRecipe(recipeOf({ title }), 'jsonLd')).toEqual(
                ok ? { ok: true } : { ok: false, reason: 'titleUnusable' },
            );
        });
    });

    describe('G2: at least one ingredient line', () => {
        it('refuses none, accepts one', () => {
            expect(acceptRecipe(recipeOf({ ingredientLines: [] }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'noIngredients',
            });
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 egg'] }), 'jsonLd')).toEqual({ ok: true });
        });
    });

    describe('G3: the line count and the line length are the parse job limits', () => {
        it('accepts the line limit and refuses one over it', () => {
            const lines = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1} egg`);

            expect(acceptRecipe(recipeOf({ ingredientLines: lines(MAX_PARSE_JOB_LINES) }), 'jsonLd')).toEqual({
                ok: true,
            });
            expect(acceptRecipe(recipeOf({ ingredientLines: lines(MAX_PARSE_JOB_LINES + 1) }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'tooManyIngredientLines',
            });
        });

        it('refuses a line over the length limit, and says so before the blob rule (G4) does', () => {
            expect(
                acceptRecipe(
                    recipeOf({ ingredientLines: ['1 egg', 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1)] }),
                    'jsonLd',
                ),
            ).toEqual({ ok: false, reason: 'ingredientLineTooLong' });
        });
    });

    describe('G4: an ingredient line is one line, not a blob or a sentence', () => {
        it('accepts a 200-character line and refuses a 201-character one', () => {
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 ' + 'x'.repeat(198)] }), 'jsonLd')).toEqual({
                ok: true,
            });
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 ' + 'x'.repeat(199)] }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'ingredientsNotSeparated',
            });
        });

        it('accepts one sentence end in a line and refuses two', () => {
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 egg. Large'] }), 'jsonLd')).toEqual({ ok: true });
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 egg. Whisk it. Then fold'] }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'ingredientsNotSeparated',
            });
        });

        it('counts a full stop followed by a letter only: "1.5 cups" and "2 tbsp. 3 eggs" end no sentence', () => {
            expect(
                acceptRecipe(recipeOf({ ingredientLines: ['1.5 cups milk. 2.5 cups water. 3.5 cups tea'] }), 'jsonLd'),
            ).toEqual({
                ok: true,
            });
        });

        it('does not read an abbreviation period as a sentence end: "oz. each" and "in. pieces" are one line', () => {
            expect(
                acceptRecipe(
                    recipeOf({
                        ingredientLines: ['4 medium (about 7 oz. each) Honeycrisp apples, cut into 1/2-in. pieces'],
                    }),
                    'jsonLd',
                ),
            ).toEqual({ ok: true });
        });

        it('reads a sentence end in any script', () => {
            expect(acceptRecipe(recipeOf({ ingredientLines: ['1 œuf. Fouettez. Ajoutez'] }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'ingredientsNotSeparated',
            });
        });
    });

    describe('G5: a method of real steps', () => {
        it('refuses no steps', () => {
            expect(acceptRecipe(recipeOf({ steps: [] }), 'jsonLd')).toEqual({ ok: false, reason: 'noSteps' });
        });

        it('accepts a 3-character step and refuses a 2-character one, after trimming', () => {
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Mix') }), 'jsonLd')).toEqual({ ok: true });
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Mix', '  Ok  ') }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'noSteps',
            });
        });
    });

    describe('G6: no step is an ingredient (an amount and a canonical unit, in at most 8 words)', () => {
        it('refuses a step that is an ingredient line', () => {
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Mix well', '2 cups sugar') }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'ingredientsInSteps',
            });
        });

        it('strips a section prefix first: "For the glaze: 1 cup sugar" is an ingredient', () => {
            expect(
                acceptRecipe(recipeOf({ steps: stepsOf('Mix well', 'For the glaze: 1 cup sugar') }), 'jsonLd'),
            ).toEqual({
                ok: false,
                reason: 'ingredientsInSteps',
            });
        });

        it('accepts an amount that is not followed by a canonical unit', () => {
            expect(
                acceptRecipe(recipeOf({ steps: stepsOf('Bake 20 minutes', '2 eggs go in last') }), 'jsonLd'),
            ).toEqual({
                ok: true,
            });
        });

        it('accepts a canonical unit with no leading amount', () => {
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Cups of sugar go in first', 'Stir') }), 'jsonLd')).toEqual({
                ok: true,
            });
        });

        it('accepts an ingredient-shaped step of nine words, and refuses the same shape at eight', () => {
            const eight = '2 cups sugar folded into the cold batter';
            const nine = '2 cups sugar folded into the cold batter slowly';

            expect(eight.split(' ')).toHaveLength(8);
            expect(nine.split(' ')).toHaveLength(9);
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Mix well', eight) }), 'jsonLd')).toEqual({
                ok: false,
                reason: 'ingredientsInSteps',
            });
            expect(acceptRecipe(recipeOf({ steps: stepsOf('Mix well', nine) }), 'jsonLd')).toEqual({ ok: true });
        });
    });

    describe('G7: no line is in both the ingredients and the steps', () => {
        it('refuses a line in both, ignoring case and whitespace', () => {
            expect(
                acceptRecipe(
                    recipeOf({
                        ingredientLines: ['Some fresh basil'],
                        steps: stepsOf('Mix well', '  some   FRESH basil '),
                    }),
                    'jsonLd',
                ),
            ).toEqual({ ok: false, reason: 'ingredientsInSteps' });
        });

        it('accepts a step that only contains an ingredient line', () => {
            expect(
                acceptRecipe(
                    recipeOf({
                        ingredientLines: ['Some fresh basil'],
                        steps: stepsOf('Add some fresh basil and stir'),
                    }),
                    'jsonLd',
                ),
            ).toEqual({ ok: true });
        });
    });

    describe('G8: no title, ingredient line or step holds U+FFFD or a C1 control character, or lacks a letter or digit', () => {
        it.each([
            ['the title', { title: 'Pancakes \uFFFD' }],
            ['an ingredient line', { ingredientLines: ['1 cup flour', '2 eg\uFFFDgs'] }],
            ['a step', { steps: stepsOf('Mix the batter.', 'Cook\u0085in a pan.') }],
            ['the first C1 character', { title: '\u0080Pancakes' }],
            ['the last C1 character', { title: 'Pancakes\u009F' }],
        ])('refuses %s', (_label, overrides) => {
            expect(acceptRecipe(recipeOf(overrides), 'jsonLd')).toEqual({ ok: false, reason: 'garbledText' });
        });

        it.each([
            ['an ingredient line of punctuation only', { ingredientLines: ['1 cup flour', '***'] }],
            ['a step of punctuation only', { steps: stepsOf('Mix well.', '***') }],
            // The verification review's probes: each has a token, and none has a letter or a digit.
            ['a title of punctuation only', { title: '***' }],
            ['an ingredient line of a zero-width space', { ingredientLines: ['1 cup flour', '\u200B'] }],
            ['an ingredient line of emoji only', { ingredientLines: ['1 cup flour', '\u{1F600}\u{1F600}'] }],
            ['a step of emoji only', { steps: stepsOf('Mix well.', '\u{1F525}\u{1F525}') }],
        ])('refuses %s: nothing a cook can read', (_label, overrides) => {
            expect(acceptRecipe(recipeOf(overrides), 'jsonLd')).toEqual({ ok: false, reason: 'garbledText' });
        });

        it.each(['\u007F', '\u00A0', '\u00E9', '\u2019', '\u{1F600}'])('accepts %j, just outside the set', (char) => {
            expect(
                acceptRecipe(
                    recipeOf({
                        title: `Pancakes ${char}`,
                        ingredientLines: [`1 cup flour ${char}`],
                        steps: stepsOf(`Mix ${char} well.`),
                    }),
                    'jsonLd',
                ),
            ).toEqual({ ok: true });
        });

        it('comes after G7 in table order', () => {
            expect(
                acceptRecipe(
                    recipeOf({ ingredientLines: ['1 cup flour'], steps: stepsOf('1 cup flour', 'Mix\uFFFD') }),
                    'jsonLd',
                ),
            ).toEqual({ ok: false, reason: 'ingredientsInSteps' });
        });
    });

    it('reports the first failing predicate in table order: G1 before G2 before G5', () => {
        expect(acceptRecipe(recipeOf({ title: '', ingredientLines: [], steps: [] }), 'jsonLd')).toEqual({
            ok: false,
            reason: 'titleUnusable',
        });
        expect(acceptRecipe(recipeOf({ ingredientLines: [], steps: [] }), 'jsonLd')).toEqual({
            ok: false,
            reason: 'noIngredients',
        });
    });
});
