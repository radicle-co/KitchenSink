import { recipeStepSchema } from '@kitchensink/recipe-core';
import type { RecipeStep } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { cookingStepsOf, matchStep, matchStepStrict, stepDigest } from '@kitchensink/cooking-core';
import { GOLDEN_CORPUS_STEPS } from '../src/__fixtures__/stepLinesGolden.js';

/**
 * A saved step follows its text through an edit of the recipe, across the real splitter and the real digest. The
 * unit tests give `matchStep` a hand-made digest list. This one builds the list the way the cook screen does: the
 * recipe's steps parsed by recipe-core's own zod, blank ones skipped by `cookingStepsOf`, each walked step hashed. A
 * blank step is where the raw index and the walked index disagree, which a hand-made list cannot show.
 */

const RECIPE_ID = '01JCOOKINGDIGEST000000000A';

const recipes = GOLDEN_CORPUS_STEPS.reduce((all, step) => {
    all.set(step.recipe, [...(all.get(step.recipe) ?? []), step.text]);

    return all;
}, new Map<string, string[]>());
const [GOLDEN] = [...recipes.values()].filter((texts) => texts.length >= 4);

if (GOLDEN === undefined) {
    throw new Error('the golden corpus has no recipe of four steps');
}

const parsed = (instructions: readonly string[]): RecipeStep[] =>
    instructions.map((instruction, index) =>
        recipeStepSchema.parse({
            id: `01JCOOKINGDIGEST0000${String(index).padStart(6, '0')}`,
            recipeId: RECIPE_ID,
            stepNumber: index + 1,
            instruction,
        }),
    );

/** The digest of each step the cook walks, in order: what the store's `rebind` is given. */
const digestsOf = (instructions: readonly string[]): string[] => {
    const steps = parsed(instructions);

    return cookingStepsOf(steps).map(({ stepNumber }) => {
        const step = steps.find((candidate) => candidate.stepNumber === stepNumber);

        return stepDigest(step?.instruction ?? '');
    });
};

const at = (instructions: readonly string[], index: number) => ({
    index,
    digest: digestsOf(instructions)[index] ?? '',
});

describe('a saved step follows its text through an edit of the recipe', () => {
    it('hashes every walked step of a real recipe to a different digest', () => {
        const digests = digestsOf(GOLDEN);

        expect(new Set(digests).size).toBe(GOLDEN.length);
    });

    it('moves with the step when a step is inserted before it', () => {
        const saved = at(GOLDEN, 2);
        const edited = ['Beat the eggs until light.', ...GOLDEN];

        expect(matchStep(saved, digestsOf(edited))).toBe(3);
        expect(matchStepStrict(saved, digestsOf(edited))).toBe(3);
    });

    it('moves with the step when two steps swap places', () => {
        const saved = at(GOLDEN, 1);
        const [first, second, ...rest] = GOLDEN;
        const edited = [second ?? '', first ?? '', ...rest];

        expect(matchStep(saved, digestsOf(edited))).toBe(0);
        expect(matchStepStrict(saved, digestsOf(edited))).toBe(0);
    });

    it('drops a mark on an edited step and clamps the saved step to its old index', () => {
        const saved = at(GOLDEN, 1);
        const edited = GOLDEN.map((text, index) => (index === 1 ? `${text} Serve at once.` : text));

        expect(matchStepStrict(saved, digestsOf(edited))).toBeUndefined();
        expect(matchStep(saved, digestsOf(edited))).toBe(1);
    });

    it('counts a blank step in the middle as no step, on both sides of the edit', () => {
        const withBlank = [GOLDEN[0] ?? '', '   ', ...GOLDEN.slice(1)];
        const saved = at(withBlank, 1);

        expect(digestsOf(withBlank)).toHaveLength(GOLDEN.length);
        expect(saved.digest).toBe(stepDigest(GOLDEN[1] ?? ''));
        expect(matchStep(saved, digestsOf(GOLDEN))).toBe(1);
        expect(matchStep(saved, digestsOf(['Heat the pan.', ...withBlank]))).toBe(2);
    });
});
