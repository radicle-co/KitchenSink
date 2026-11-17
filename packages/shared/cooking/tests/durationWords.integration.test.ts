import { cookingStepsOf, offerSecondsOf, readDuration } from '@kitchensink/cooking-core';
import { recipeStepSchema } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { CORPUS_OFFERS, NEGATIVE_LINES, POSITIVE_LINE_OFFERS } from '../src/__fixtures__/corpusOffers.js';
import { GOLDEN_CORPUS_STEPS } from '../src/__fixtures__/stepLinesGolden.js';

/**
 * Times written in words, through the package's PUBLIC surface and over steps parsed by recipe-core's own schema and
 * split by the real splitter. Nothing is mocked. The unit tier imports each module by path, so only this tier fails
 * when the barrel stops exporting the reader, or when the lines cooking mode shows and the lines the table labels stop
 * agreeing.
 */

const RECIPE_ID = '01JCOOKINGWORDSINTEG00000A';

/** Every corpus step as a recipe step, then as cooking mode walks it. */
const corpusSteps = cookingStepsOf(
    GOLDEN_CORPUS_STEPS.map((step, index) =>
        recipeStepSchema.parse({
            id: `01JCOOKINGWORDSINTEG${String(index).padStart(5, '0')}`,
            recipeId: RECIPE_ID,
            stepNumber: index + 1,
            instruction: step.text,
        }),
    ),
);

describe('times written in words, over the corpus steps a cook walks', () => {
    it('walks every corpus step', () => {
        expect(corpusSteps).toHaveLength(CORPUS_OFFERS.length);
    });

    it.each(CORPUS_OFFERS.map((row, index) => [`${row.recipe} ${row.step}`, row.offers, index] as const))(
        '%s offers what the table says',
        (_name, offers, index) => {
            const lines = corpusSteps[index]?.lines ?? [];

            expect(lines.flatMap((line) => offerSecondsOf({ line }) ?? [])).toEqual(offers);
        },
    );

    it.each(POSITIVE_LINE_OFFERS.map((row) => [row.line, row.seconds] as const))('%s offers %s s', (line, seconds) => {
        expect(offerSecondsOf({ line })).toBe(seconds);
    });

    it.each(NEGATIVE_LINES.map((line) => [line] as const))('%s offers nothing', (line) => {
        expect(offerSecondsOf({ line })).toBeUndefined();
    });

    it('gives a word range its high end through the barrel', () => {
        expect(readDuration('Ten to fifteen minutes')).toEqual({ kind: 'one', seconds: 600, highSeconds: 900 });
    });
});
