/**
 * The failure-record vocabulary (plan 002 U2): why a lookup ended unresolved, and the coarse status that
 * reason implies. The recipe service's `unresolved_foods` CHECK and its generated `status` column pin the same
 * sets against a real database (`tests/e2e/ingredientGrain.e2e.test.ts`); this suite pins the TypeScript side
 * that the wire and the service share.
 */
import { describe, expect, it } from 'vitest';

import {
    FoodResolutionStatus,
    foodResolutionStatusSchema,
    lineResolutionStatusSchema,
} from '../foodResolutionStatus.js';
import {
    UNRESOLVED_FOOD_REASON_CODES,
    UNRESOLVED_FOOD_STATUSES,
    unresolvedFoodReasonSchema,
} from '../unresolvedFood.js';

describe('the unresolved-food vocabulary', () => {
    it('names the eight reasons, and only them', () => {
        expect([...UNRESOLVED_FOOD_REASON_CODES].sort()).toStrictEqual([
            'author_declared',
            'awaiting_source',
            'cascade_exhausted',
            'cascade_unavailable',
            'no_source_has_it',
            'phrase_unusable',
            'several_candidates',
            'sources_errored',
        ]);
    });

    it('parses every reason and refuses one outside the set', () => {
        for (const reason of UNRESOLVED_FOOD_REASON_CODES) {
            expect(unresolvedFoodReasonSchema.parse(reason)).toBe(reason);
        }

        expect(unresolvedFoodReasonSchema.safeParse('invented_reason').success).toBe(false);
    });

    it('⛔ holds every failure status and never RESOLVED — a resolved lookup has no failure record', () => {
        expect([...UNRESOLVED_FOOD_STATUSES].sort()).toStrictEqual([
            FoodResolutionStatus.FAILED,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.UNRESOLVED,
        ]);
        expect(UNRESOLVED_FOOD_STATUSES).not.toContain(FoodResolutionStatus.RESOLVED);
    });

    it('⛔ is the CATALOG status schema MINUS `RESOLVED`, computed rather than hand-listed', () => {
        // `satisfies` cannot say "proper subset", so the difference is computed from the catalog schema: a
        // catalog status added upstream fails here until someone decides whether a failure record may hold it.
        expect([...UNRESOLVED_FOOD_STATUSES].sort()).toStrictEqual(
            foodResolutionStatusSchema.options.filter((option) => option !== FoodResolutionStatus.RESOLVED).sort(),
        );
        // The control: the value really IS in the set being subtracted from.
        expect(foodResolutionStatusSchema.options).toContain(FoodResolutionStatus.RESOLVED);
    });

    it('⛔ excludes NEEDS_REVIEW, which the line union carries and a shared failure record may not', () => {
        // `NEEDS_REVIEW` is a per-RECIPE-LINE verdict, and migration 0023 forbids writing one to a SHARED row.
        expect(UNRESOLVED_FOOD_STATUSES).not.toContain(FoodResolutionStatus.NEEDS_REVIEW);
        expect(lineResolutionStatusSchema.options).toContain(FoodResolutionStatus.NEEDS_REVIEW);
    });
});
