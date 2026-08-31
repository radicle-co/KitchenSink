/**
 * The needs-review resolution status (plan U14 / R15) — and the boundary that keeps it OFF the shared
 * catalog.
 *
 * ⛔ THE SET RELATION IS THE WHOLE POINT, and it is asserted in BOTH directions rather than spot-checked.
 * `0023_line_verifications.sql` forbids a gate verdict on `ingredients.food_resolution_status` for three
 * independent reasons, the first being blast radius on a SHARED, ownerless catalog deduped one row per
 * `food_id`. `NEEDS_REVIEW` is therefore a RECIPE-LINE status and never a catalog one, and the two schemas
 * below are what makes that unrepresentable instead of merely documented.
 */
import { describe, it, expect } from 'vitest';

import {
    FoodResolutionStatus,
    foodResolutionStatusSchema,
    lineResolutionStatusSchema,
    recipeIngredientViewSchema,
} from '../index.js';

describe('FoodResolutionStatus — the NEEDS_REVIEW member (U14)', () => {
    it('names the verification-disagreement state', () => {
        expect(FoodResolutionStatus.NEEDS_REVIEW).toBe('NEEDS_REVIEW');
    });
});

describe('foodResolutionStatusSchema — the food-service MIRROR, unwidened', () => {
    it('admits exactly the five values food-service can report', () => {
        expect([...foodResolutionStatusSchema.options].sort()).toEqual([
            'FAILED',
            'NOT_FOUND',
            'PENDING',
            'RESOLVED',
            'UNRESOLVED',
        ]);
    });

    it('REFUSES NEEDS_REVIEW — a gate verdict may never ride the shared catalog row (0023)', () => {
        expect(foodResolutionStatusSchema.safeParse(FoodResolutionStatus.NEEDS_REVIEW).success).toBe(false);
    });
});

describe('lineResolutionStatusSchema — the per-RECIPE-LINE status', () => {
    it('admits every mirror value', () => {
        for (const status of foodResolutionStatusSchema.options) {
            expect(lineResolutionStatusSchema.safeParse(status).success).toBe(true);
        }
    });

    it('admits NEEDS_REVIEW', () => {
        expect(lineResolutionStatusSchema.safeParse('NEEDS_REVIEW').success).toBe(true);
    });

    it('adds EXACTLY two members to the mirror — nothing else drifts in', () => {
        // ⚠️ REWRITTEN for plan U4c: KTD-A's derived `PENDING_VERIFICATION` joined `NEEDS_REVIEW` as the
        // second recipe-line-only member. Both are derived at read and never written to a catalog row —
        // the closed catalog schema is asserted unchanged below.
        const extra = lineResolutionStatusSchema.options.filter(
            (status) => !(foodResolutionStatusSchema.options as readonly string[]).includes(status),
        );

        expect(extra).toEqual(['NEEDS_REVIEW', 'PENDING_VERIFICATION']);
    });

    it('admits PENDING_VERIFICATION — and the CATALOG schema still refuses it', () => {
        expect(lineResolutionStatusSchema.safeParse('PENDING_VERIFICATION').success).toBe(true);
        expect(foodResolutionStatusSchema.safeParse('PENDING_VERIFICATION').success).toBe(false);
    });

    it('rejects an unknown status', () => {
        expect(lineResolutionStatusSchema.safeParse('REVIEWED').success).toBe(false);
    });
});

describe('recipeIngredientViewSchema — the per-line status on the wire (U14)', () => {
    /** A schema-valid line the cases below mutate one field at a time. */
    const makeLine = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        ingredientId: 'ing_1',
        name: 'plain flour',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        isUserEntered: false,
        ...overrides,
    });

    it('carries NEEDS_REVIEW when the gate contradicted the line', () => {
        const parsed = recipeIngredientViewSchema.parse(makeLine({ resolutionStatus: 'NEEDS_REVIEW' }));

        expect(parsed.resolutionStatus).toBe('NEEDS_REVIEW');
    });

    it('carries a mirror status for a line whose food is still resolving', () => {
        expect(recipeIngredientViewSchema.parse(makeLine({ resolutionStatus: 'PENDING' })).resolutionStatus).toBe(
            'PENDING',
        );
    });

    it('leaves it ABSENT when there is no verdict and no food link — absence means publish (0023)', () => {
        expect(recipeIngredientViewSchema.parse(makeLine()).resolutionStatus).toBeUndefined();
    });

    it('rejects a status outside the line union', () => {
        expect(recipeIngredientViewSchema.safeParse(makeLine({ resolutionStatus: 'WITHHELD' })).success).toBe(false);
    });

    it('is NON-STRICT, so a client built before this field STRIPS it instead of rejecting the recipe', () => {
        // The wire-compatibility argument in one assertion: an unknown key is dropped, not fatal. That is why
        // `resolutionStatus` could be added to this shape while a `.strict()` member (the `unaccounted`
        // nutrition state) cannot be widened without breaking an older reader.
        const parsed = recipeIngredientViewSchema.parse(makeLine({ someFutureField: 'x' }));

        expect(parsed).not.toHaveProperty('someFutureField');
    });
});
