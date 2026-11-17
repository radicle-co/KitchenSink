import { recipeStepSchema } from '@kitchensink/recipe-core';
import type { RecipeStep } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { cookingStepsOf, createLineTicks, focusLineOf, stepDigest, tickLine } from '@kitchensink/cooking-core';
import type { TappedLine } from '@kitchensink/cooking-core';

/**
 * The tapped focus follows its step's text through an owner's edit, across the real splitter, the real digest and the
 * real ticks. The unit tests hand `focusLineOf` a digest string. This one builds it as the cook
 * screen does: the recipe's steps parsed by recipe-core's own zod, split into lines by `cookingStepsOf`, and the digest
 * of each walked step's instruction text taken from the kept store's function.
 */

const RECIPE_ID = '01JCOOKINGFOCUS0000000000A';

const parsed = (instructions: readonly string[]): RecipeStep[] =>
    instructions.map((instruction, index) =>
        recipeStepSchema.parse({
            id: `01JCOOKINGFOCUS00000${String(index).padStart(5, '0')}`,
            recipeId: RECIPE_ID,
            stepNumber: index + 1,
            instruction,
        }),
    );

const INSTRUCTIONS = [
    'Heat the oil.',
    'Chop the onion. Slice the garlic. Grate the ginger.',
    'Simmer for 20 minutes. Season it.',
] as const;

const stepsOf = (instructions: readonly string[]) => cookingStepsOf(parsed(instructions));
const digestOf = (instructions: readonly string[], index: number): string => stepDigest(instructions[index] ?? '');

describe('the tapped focus, over the real splitter and digest', () => {
    const tapAtC = (instructions: readonly string[]): TappedLine => ({
        stepIndex: 1,
        stepDigest: digestOf(instructions, 1),
        lineIndex: 2,
        tickedAtTap: [],
    });

    it('holds on the line the cook tapped while the recipe is unchanged', () => {
        expect(
            focusLineOf({
                ticks: createLineTicks(),
                stepIndex: 1,
                steps: stepsOf(INSTRUCTIONS),
                stepDigest: digestOf(INSTRUCTIONS, 1),
                tapped: tapAtC(INSTRUCTIONS),
            }),
        ).toBe(2);
    });

    it('ends when the owner edits the tapped step, even though line C still exists', () => {
        const edited = [INSTRUCTIONS[0], 'Chop the onion. Slice the garlic. Grate the root ginger.', INSTRUCTIONS[2]];

        expect(
            focusLineOf({
                ticks: createLineTicks(),
                stepIndex: 1,
                steps: stepsOf(edited),
                stepDigest: digestOf(edited, 1),
                tapped: tapAtC(INSTRUCTIONS),
            }),
        ).toBe(0);
    });

    it('holds when the owner edits a different step', () => {
        const edited = ['Heat the olive oil.', INSTRUCTIONS[1], INSTRUCTIONS[2]];

        expect(
            focusLineOf({
                ticks: createLineTicks(),
                stepIndex: 1,
                steps: stepsOf(edited),
                stepDigest: digestOf(edited, 1),
                tapped: tapAtC(INSTRUCTIONS),
            }),
        ).toBe(2);
    });

    it('ends when the cook ticks the line after tapping it, and the focus is the first unticked line', () => {
        const steps = stepsOf(INSTRUCTIONS);
        const ticks = tickLine(createLineTicks(), { stepIndex: 1, lineIndex: 2 }, steps);

        expect(
            focusLineOf({
                ticks,
                stepIndex: 1,
                steps,
                stepDigest: digestOf(INSTRUCTIONS, 1),
                tapped: tapAtC(INSTRUCTIONS),
            }),
        ).toBe(0);
    });
});
