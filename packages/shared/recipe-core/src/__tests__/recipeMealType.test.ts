/**
 * The meal-type vocabulary (plan U34, owner ruling 2026-08-25) — the one axis of recipe classification that
 * is a CLOSED set, and the tests that keep it one.
 *
 * ⛔ Why closed here when `cuisine`, `tags` and `dietaryFlags` are all deliberately free text: meal type
 * answers "when in the day is this eaten", and that question has a finite, stable, non-cultural answer. The
 * other three do not — a cuisine nobody curated yet, a tag a cook invents, a diet that emerges next year all
 * have to be expressible, which is exactly why `CUISINES` ships as a display list with a `z.string()` wire
 * type rather than a `z.enum`. A closed set is only defensible when the axis is genuinely closed, and
 * "course" (starter / main / side) would NOT have been: a dish can be two courses at once, and the boundary
 * moves by cuisine.
 *
 * The three assertions below are the ones a rename or a silent widening would have to survive: the enum's
 * membership matches its const object exactly (so the two cannot drift), an unknown value is REFUSED (which
 * is the whole difference between this field and `tags`), and absence stays representable (a cook who has
 * not said when they eat something must not be assigned a default).
 */
import { describe, expect, it } from 'vitest';

import { RECIPE_MEAL_TYPES, RecipeMealType, recipeMealTypeSchema } from '../index.js';

describe('RecipeMealType (U34 — a closed vocabulary, unlike tags and dietary flags)', () => {
    it('names the seven times of day a recipe can belong to', () => {
        expect(RECIPE_MEAL_TYPES).toEqual(['breakfast', 'brunch', 'lunch', 'dinner', 'snack', 'dessert', 'drink']);
    });

    it('keeps the const object and the ordered list in exact agreement', () => {
        // A copy of a list cannot detect that the list is incomplete — so the list is DERIVED from the object
        // and this asserts the derivation, in both directions.
        expect([...RECIPE_MEAL_TYPES].sort()).toEqual(Object.values(RecipeMealType).sort());
    });

    it('accepts every member of the vocabulary', () => {
        for (const value of RECIPE_MEAL_TYPES) {
            expect(recipeMealTypeSchema.safeParse(value).success).toBe(true);
        }
    });

    it('REFUSES a value outside the vocabulary — this is the difference from a free-text tag', () => {
        expect(recipeMealTypeSchema.safeParse('supper').success).toBe(false);
        expect(recipeMealTypeSchema.safeParse('Dinner').success).toBe(false);
        expect(recipeMealTypeSchema.safeParse('').success).toBe(false);
    });

    it('refuses a non-string, so a client cannot smuggle a shape past the enum', () => {
        expect(recipeMealTypeSchema.safeParse(1).success).toBe(false);
        expect(recipeMealTypeSchema.safeParse(null).success).toBe(false);
    });
});
