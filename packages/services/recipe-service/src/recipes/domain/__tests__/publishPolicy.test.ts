/**
 * Unit tests for the pure publish policy (owner rulings 2026-10-13; the third sibling of `evaluateProvenance` and
 * `evaluateVisibility`).
 *
 * Pins every row of "may a recipe be in this state?" over `(status, sourceType, cuisine, ingredientCount, stepCount)`.
 * The rows a mutant must not survive:
 *
 *  1. **A draft is always allowed**, however empty: that is what a draft IS, and the editor saves one on a cadence.
 *  2. **Only `imported_public` is exempt from the cuisine**, and `imported_physical`/`imported_paid` are NOT: the owner
 *     exempted the public-domain cookbook import, not imports in general.
 *  3. **Every gap is listed, in page order**, so the editor's "Fix {count} things" counts each.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType, RecipeStatus, type PublishRequirement } from '@kitchensink/recipe-core';

import { evaluatePublication, requiresCuisine, type PublishPolicyInput } from '../publishPolicy.js';

/** A recipe that meets every requirement. */
const COMPLETE: PublishPolicyInput = {
    status: RecipeStatus.PUBLISHED,
    sourceType: RecipeSourceType.USER_CREATED,
    cuisine: 'Thai',
    ingredientCount: 1,
    stepCount: 1,
};

/** The requirements a decision says are missing, or `[]` when it allows. */
function missingOf(input: Partial<PublishPolicyInput>): readonly PublishRequirement[] {
    const decision = evaluatePublication({ ...COMPLETE, ...input });

    expect(decision.reason.length).toBeGreaterThan(0);

    return decision.allowed ? [] : decision.missing;
}

describe('evaluatePublication — a published recipe', () => {
    it('allows one that meets every requirement', () => {
        expect(missingOf({})).toEqual([]);
    });

    it.each([
        ['no cuisine', { cuisine: null }, ['cuisine']],
        ['no ingredient', { ingredientCount: 0 }, ['ingredients']],
        ['no step', { stepCount: 0 }, ['steps']],
        [
            'nothing at all, listed in page order',
            { cuisine: null, ingredientCount: 0, stepCount: 0 },
            ['cuisine', 'ingredients', 'steps'],
        ],
        ['a cuisine and no ingredient or step', { stepCount: 0, ingredientCount: 0 }, ['ingredients', 'steps']],
    ] as const)('refuses one with %s', (_name, input, missing) => {
        expect(missingOf(input)).toEqual(missing);
    });
});

describe('evaluatePublication — the cuisine exemption is the public-domain import, and only that', () => {
    it('exempts an imported_public recipe (the curator path, ADR-0023), and so a clone of one, which keeps the type', () => {
        expect(missingOf({ sourceType: RecipeSourceType.IMPORTED_PUBLIC, cuisine: null })).toEqual([]);
    });

    it('still asks an imported_public recipe for its ingredients and steps', () => {
        expect(
            missingOf({
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                cuisine: null,
                ingredientCount: 0,
                stepCount: 0,
            }),
        ).toEqual(['ingredients', 'steps']);
    });

    it.each([RecipeSourceType.USER_CREATED, RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])(
        'asks a %s recipe for a cuisine',
        (sourceType) => {
            expect(missingOf({ sourceType, cuisine: null })).toEqual(['cuisine']);
        },
    );

    it('requiresCuisine answers for every source type', () => {
        expect(requiresCuisine(RecipeSourceType.USER_CREATED)).toBe(true);
        expect(requiresCuisine(RecipeSourceType.IMPORTED_PHYSICAL)).toBe(true);
        expect(requiresCuisine(RecipeSourceType.IMPORTED_PAID)).toBe(true);
        expect(requiresCuisine(RecipeSourceType.IMPORTED_PUBLIC)).toBe(false);
    });
});

describe('evaluatePublication — a draft', () => {
    it.each([RecipeSourceType.USER_CREATED, RecipeSourceType.IMPORTED_PUBLIC])(
        'allows a %s draft with nothing in it',
        (sourceType) => {
            expect(
                missingOf({ status: RecipeStatus.DRAFT, sourceType, cuisine: null, ingredientCount: 0, stepCount: 0 }),
            ).toEqual([]);
        },
    );
});

describe('evaluatePublication — the cuisine is judged as it will be stored', () => {
    it('treats an empty or blank cuisine as no cuisine', () => {
        expect(missingOf({ cuisine: '' })).toEqual(['cuisine']);
        expect(missingOf({ cuisine: '   ' })).toEqual(['cuisine']);
    });

    it('accepts a cuisine the list does not hold: free text is a cuisine', () => {
        expect(missingOf({ cuisine: 'Nyonya' })).toEqual([]);
    });
});
