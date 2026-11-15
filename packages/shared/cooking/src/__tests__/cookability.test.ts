import { RecipeStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { countCookableSteps, hasStepText, isCookable } from '../cookability.js';

/** The one predicate for "a step with text" (FR-033a), which the step list and the count both use. */
describe('hasStepText', () => {
    it.each([
        ['Heat the oil.', true],
        ['  Heat the oil.  ', true],
        ['x', true],
        ['', false],
        ['   ', false],
        ['\n\t', false],
        [' ', false],
    ])('%j -> %s', (text, expected) => {
        expect(hasStepText(text)).toBe(expected);
    });
});

/**
 * FR-033a: a step whose text is empty or only whitespace is not a step for the cook. Only steps with text
 * count, so a recipe whose steps are all blank has nothing to cook, and blank steps among real ones are skipped.
 */
describe('countCookableSteps', () => {
    it.each([
        [[], 0],
        [['Heat the oil.'], 1],
        [['', '   ', '\n\t'], 0],
        [['Heat the oil.', '', 'Add the onion.', 'Fry.'], 3],
        [['', 'Heat the oil.'], 1],
        [[' ', 'Heat the oil.'], 1],
    ])('%j has %d steps to cook', (instructions, expected) => {
        expect(countCookableSteps(instructions)).toBe(expected);
    });

    it('feeds the rule: all blank is not cookable, a blank and a real step is', () => {
        const published = RecipeStatus.PUBLISHED;

        expect(isCookable({ status: published, stepCount: countCookableSteps(['', '  ']) })).toBe(false);
        expect(isCookable({ status: published, stepCount: countCookableSteps(['', 'Heat the oil.']) })).toBe(true);
    });
});

/**
 * Start cooking exists only where a cook can cook. One row per recipe state. The rule takes the recipe's status and step count and
 * nothing about the viewer, so the same recipe answers the same for its owner and for another cook.
 */
describe('isCookable', () => {
    it.each([
        ['a published recipe with steps', RecipeStatus.PUBLISHED, 6, true],
        ['a published recipe with one step', RecipeStatus.PUBLISHED, 1, true],
        ['a published recipe with no steps', RecipeStatus.PUBLISHED, 0, false],
        ['a draft with steps', RecipeStatus.DRAFT, 6, false],
        ['a draft with no steps', RecipeStatus.DRAFT, 0, false],
        // "Not approved" is a recipe made private again: it stays published, so it is cookable.
        ['a not-approved recipe, private again but published, with steps', RecipeStatus.PUBLISHED, 3, true],
        // Another cook's public recipe reads the same as one's own: the rule has no viewer input.
        ["another cook's public recipe, published with steps", RecipeStatus.PUBLISHED, 4, true],
        // A facts card carries a step COUNT of zero (ADR-0082), so there is nothing to cook.
        ['a facts card with no steps', RecipeStatus.PUBLISHED, 0, false],
    ])('%s -> %s', (_label, status, stepCount, expected) => {
        expect(isCookable({ status, stepCount })).toBe(expected);
    });

    it('refuses a negative or fractional step count, which no recipe has', () => {
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount: -1 })).toBe(false);
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount: 1.5 })).toBe(false);
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount: Number.NaN })).toBe(false);
    });
});
