import { RecipeStatus, recipeStepSchema } from '@kitchensink/recipe-core';
import type { RecipeStep } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    advance,
    allLinesTicked,
    cookLinkOutcome,
    cookingStepsOf,
    createLineTicks,
    createSession,
    focusLineIndex,
    goBack,
    isCookable,
    linePlace,
    sessionStatus,
    stepPlace,
    tickLine,
    tickedLineCount,
} from '../src/index.js';
import type { CookingStep, LineTicks } from '../src/index.js';
import { GOLDEN_CORPUS_STEPS } from '../src/__fixtures__/stepLinesGolden.js';

/**
 * The composed walk through the package's PUBLIC surface: recipe steps parsed by recipe-core's own zod →
 * `cookingStepsOf` (the real splitter) → the entry specification → the session reducer and the line-ticks reducer →
 * Done → Cook it again. No module is mocked; this is the seam a unit test of each piece cannot see (the step count the
 * entry rule reads is the one the reducer walks, and the line count the ticks are bounded by is the one the splitter
 * produced).
 *
 * The recipes are the public-domain 1919 recipes of the splitter's golden fixture, so every step and line is real
 * cookbook text.
 */

const RECIPE_ID = '01JCOOKINGWALK0000000000AA';

function parsedSteps(instructions: readonly string[]): RecipeStep[] {
    return instructions.map((instruction, index) =>
        recipeStepSchema.parse({
            id: `01JCOOKINGWALK00000000${String(index).padStart(4, '0')}`,
            recipeId: RECIPE_ID,
            stepNumber: index + 1,
            instruction,
        }),
    );
}

const GOLDEN_RECIPES: ReadonlyMap<string, readonly string[]> = GOLDEN_CORPUS_STEPS.reduce((recipes, step) => {
    recipes.set(step.recipe, [...(recipes.get(step.recipe) ?? []), step.text]);

    return recipes;
}, new Map<string, string[]>());

/** Ticks every line of one step in focus order, asserting the focus moves to the next line each time. */
function tickEveryLine(ticks: LineTicks, stepIndex: number, steps: readonly CookingStep[]): LineTicks {
    const step = steps[stepIndex];

    if (step === undefined) {
        throw new Error(`no step ${stepIndex}`);
    }

    let next = ticks;

    for (let line = 0; line < step.lines.length; line++) {
        expect(focusLineIndex(next, stepIndex, steps)).toBe(line);
        expect(linePlace(line, step)?.position ?? 1).toBe(line + 1);
        next = tickLine(next, { stepIndex, lineIndex: line }, steps);
    }

    expect(allLinesTicked(next, stepIndex, steps)).toBe(true);

    return next;
}

describe('stepWalk — every 1919 fixture recipe cooked from Start to Done and again', () => {
    it.each([...GOLDEN_RECIPES.keys()])('%s', (title) => {
        const steps = cookingStepsOf(parsedSteps(GOLDEN_RECIPES.get(title) ?? []));
        const total = steps.length;
        const golden = GOLDEN_CORPUS_STEPS.filter((step) => step.recipe === title);

        expect(total).toBe(golden.length);
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount: total })).toBe(true);
        expect(
            cookLinkOutcome({ status: RecipeStatus.PUBLISHED, stepCount: total, isOwner: false, readable: true }),
        ).toBe('cook');

        let session = createSession({ recipeId: RECIPE_ID, steps, startedAt: '2026-11-13T10:00:00.000Z' });
        let ticks = createLineTicks();

        for (const [stepIndex, step] of steps.entries()) {
            expect(session.currentStepIndex).toBe(stepIndex);
            expect(stepPlace(stepIndex, total)).toMatchObject({ position: stepIndex + 1, total });
            expect(step.lines.join(' ')).toBe(golden[stepIndex]?.text);
            expect(sessionStatus(session, steps)).not.toBe('complete');

            ticks = tickEveryLine(ticks, stepIndex, steps);
            session = advance(session, steps);
        }

        expect(sessionStatus(session, steps)).toBe('complete');

        const again = createSession({ recipeId: RECIPE_ID, steps, startedAt: '2026-11-13T11:00:00.000Z' });
        const fresh = createLineTicks();

        expect(again.currentStepIndex).toBe(0);
        expect(focusLineIndex(fresh, 0, steps)).toBe(0);
        expect(tickedLineCount(fresh, 0)).toBe(0);
    });
});

describe('stepWalk — Back keeps the ticks the cook left', () => {
    it('tick line 1 of step 2, go to step 3, come Back: line 1 is ticked and line 2 is the focus', () => {
        const steps = cookingStepsOf(
            parsedSteps(['Heat the oven.', 'Cream the butter. Add the sugar. Beat well.', 'Bake for 20 minutes.']),
        );
        let session = createSession({
            recipeId: RECIPE_ID,
            steps,
            startedAt: '2026-11-13T10:00:00.000Z',
        });

        session = advance(session, steps);
        const ticks = tickLine(createLineTicks(), { stepIndex: 1, lineIndex: 0 }, steps);
        session = goBack(advance(session, steps), steps);

        expect(session.currentStepIndex).toBe(1);
        expect(focusLineIndex(ticks, 1, steps)).toBe(1);
        expect(tickedLineCount(ticks, 1)).toBe(1);
    });
});

describe('stepWalk — a blank step is not a step for the cook', () => {
    it('[text, blank, text, text]: Next lands on recipe step 3 as Step 2 of 3, Back returns, Done counts 3', () => {
        const steps = cookingStepsOf(parsedSteps(['Mix the dough.', '   ', 'Knead it well.', 'Bake the loaf.']));
        const total = steps.length;
        let session = createSession({ recipeId: RECIPE_ID, steps, startedAt: '2026-11-13T10:00:00.000Z' });

        expect(total).toBe(3);

        session = advance(session, steps);
        expect(steps[session.currentStepIndex]?.stepNumber).toBe(3);
        expect(stepPlace(session.currentStepIndex, total)).toMatchObject({ position: 2, total: 3 });

        session = goBack(session, steps);
        expect(steps[session.currentStepIndex]?.stepNumber).toBe(1);

        session = advance(advance(advance(session, steps), steps), steps);
        expect(sessionStatus(session, steps)).toBe('complete');
    });

    it('a recipe whose steps are all blank is not cookable, and its cook link shows no steps', () => {
        const stepCount = cookingStepsOf(parsedSteps([' ', '\n'])).length;

        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount })).toBe(false);
        expect(cookLinkOutcome({ status: RecipeStatus.PUBLISHED, stepCount, isOwner: true, readable: true })).toBe(
            'noSteps',
        );
    });
});
