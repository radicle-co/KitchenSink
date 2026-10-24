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
    NAMELESS_LINE_STATUSES,
    recipeIngredientSchema,
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

    it('adds EXACTLY six members to the mirror — nothing else drifts in', () => {
        // ⚠️ REWRITTEN for plan U4c: KTD-A's derived `PENDING_VERIFICATION` joined `NEEDS_REVIEW` as the
        // second recipe-line-only member. Both are derived at read and never written to a catalog row —
        // the closed catalog schema is asserted unchanged below.
        const extra = lineResolutionStatusSchema.options.filter(
            (status) => !(foodResolutionStatusSchema.options as readonly string[]).includes(status),
        );

        // ⚠️ REWRITTEN for plan U13: D7/R9's `AMBIGUOUS` (the gate abstained over materially-different
        // candidates — author-actionable) and R20's `RESOLVED_UNAVAILABLE` (bound, but the food entity is
        // not served to THIS viewer — a private authored food on a public recipe) joined the line-only set.
        // ⚠️ REWRITTEN again (owner rulings 3 + 4, 2026-09-07): `FOOD_REMOVED` joins the line-only set —
        // the line's food was withdrawn by its author. Unlike the four above it is not a value recipe
        // derives from its OWN evidence; it reports a fact food owns, read live and never persisted.
        // ⚠️ REWRITTEN again (plan 002 U7, R2/R36): `FOOD_UNREACHABLE` joins — the line is bound but food-service
        // could not be asked on this read. It is transient, and it must never read as `FOOD_REMOVED`.
        expect([...extra].sort()).toEqual([
            'AMBIGUOUS',
            'FOOD_REMOVED',
            'FOOD_UNREACHABLE',
            'NEEDS_REVIEW',
            'PENDING_VERIFICATION',
            'RESOLVED_UNAVAILABLE',
        ]);
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

describe('the U13 line-only members — AMBIGUOUS and RESOLVED_UNAVAILABLE', () => {
    it('admits both on the LINE schema', () => {
        expect(lineResolutionStatusSchema.safeParse('AMBIGUOUS').success).toBe(true);
        expect(lineResolutionStatusSchema.safeParse('RESOLVED_UNAVAILABLE').success).toBe(true);
    });

    it('⛔ the CATALOG schema refuses both — the catalog union stays CLOSED (0023 blast-radius rule)', () => {
        expect(foodResolutionStatusSchema.safeParse('AMBIGUOUS').success).toBe(false);
        expect(foodResolutionStatusSchema.safeParse('RESOLVED_UNAVAILABLE').success).toBe(false);
    });

    it('⛔ AMBIGUOUS is not UNRESOLVED: the disambiguation picker semantics must never trigger on it', () => {
        // UNRESOLVED drives the CANDIDATE picker (several catalog candidates, pick one). AMBIGUOUS is the
        // GATE abstaining over a shortlist whose members differ materially — a different affordance
        // (re-derived shortlist, one pick binds siblings, writes a correction). Same word territory,
        // different machinery; the members being distinct is what keeps a picker row dead-branch-free.
        expect(FoodResolutionStatus.AMBIGUOUS).not.toBe(FoodResolutionStatus.UNRESOLVED);
    });
});

/**
 * ⛔ `FOOD_REMOVED` — the line whose food its AUTHOR withdrew (owner rulings 3, 4, 2026-09-07).
 *
 * It belongs to the LINE schema and never the catalog one, for the same structural reason as its four
 * siblings but arrived at from the opposite direction. `NEEDS_REVIEW`, `PENDING_VERIFICATION`, `AMBIGUOUS`
 * and `RESOLVED_UNAVAILABLE` are line-only because recipe DERIVES them from its own evidence.
 * `FOOD_REMOVED` is line-only because the fact it reports is FOOD's, read LIVE at the moment of the read
 * and never written down — a withdrawal is presumptively restorable, so a persisted mirror would go stale
 * claiming "removed" about a food that came back.
 *
 * ⛔ The NAME was chosen against two near-misses, and the distinction is the point. `FOOD_MISSING` was
 * correct while the fact was an inference from ABSENCE; under a retained tombstone it understates what we
 * hold, and it sits one synonym away from `NOT_FOUND` ("no wired source has it"), which is precisely the
 * discrimination failure this vocabulary exists to prevent. `FOOD_DELETED` overclaims — the row is kept.
 */
describe('FOOD_REMOVED — the withdrawn-food line status', () => {
    it('names the state', () => {
        expect(FoodResolutionStatus.FOOD_REMOVED).toBe('FOOD_REMOVED');
    });

    it('rides ONE recipe line', () => {
        expect(lineResolutionStatusSchema.safeParse(FoodResolutionStatus.FOOD_REMOVED).success).toBe(true);
    });

    it('⛔ is REFUSED by the shared catalog schema — recipe never persists it', () => {
        expect(foodResolutionStatusSchema.safeParse(FoodResolutionStatus.FOOD_REMOVED).success).toBe(false);
    });

    it('⛔ is DISTINCT from NOT_FOUND, which means "no wired source has it"', () => {
        expect(FoodResolutionStatus.FOOD_REMOVED).not.toBe(FoodResolutionStatus.NOT_FOUND);
    });

    it('reaches the wire on a recipe ingredient view', () => {
        const parsed = recipeIngredientViewSchema.safeParse({
            ingredientId: '11111111-1111-4111-8111-111111111111',
            name: 'Gran’s pie filling',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
        });

        expect(parsed.success).toBe(true);
    });
});

/**
 * Plan 002 U7 (R2, R9, R36): a bound line whose food-service answer did not arrive, and a line the viewer may
 * not name. The recipe database stores no food names (R9), so these lines reach the wire WITHOUT a name, and
 * the status is what tells the client which label to render instead.
 */
describe('FOOD_UNREACHABLE and the nameless line (plan 002 U7)', () => {
    const line = (overrides: Record<string, unknown>): Record<string, unknown> => ({
        ingredientId: '11111111-1111-4111-8111-111111111111',
        quantity: { kind: 'exact', value: 1 },
        unit: 'cup',
        isUserEntered: false,
        ...overrides,
    });

    it('⛔ FOOD_UNREACHABLE is a line status and never a catalog one', () => {
        expect(FoodResolutionStatus.FOOD_UNREACHABLE).toBe('FOOD_UNREACHABLE');
        expect(lineResolutionStatusSchema.safeParse(FoodResolutionStatus.FOOD_UNREACHABLE).success).toBe(true);
        expect(foodResolutionStatusSchema.safeParse(FoodResolutionStatus.FOOD_UNREACHABLE).success).toBe(false);
        expect(FoodResolutionStatus.FOOD_UNREACHABLE).not.toBe(FoodResolutionStatus.FOOD_REMOVED);
    });

    it('names exactly the three statuses a line may carry without a name', () => {
        expect([...NAMELESS_LINE_STATUSES].sort()).toStrictEqual([
            'FOOD_REMOVED',
            'FOOD_UNREACHABLE',
            'RESOLVED_UNAVAILABLE',
        ]);
    });

    it('admits a view with no name, and a view carrying the bound root food id', () => {
        expect(recipeIngredientViewSchema.safeParse(line({ resolutionStatus: 'FOOD_UNREACHABLE' })).success).toBe(true);
        expect(
            recipeIngredientViewSchema.safeParse(line({ name: 'beef brisket', foodId: '01JFOODROOT00000000000000A' }))
                .success,
        ).toBe(true);
    });

    it('carries an unresolved line’s reason code, and refuses one outside the vocabulary', () => {
        expect(
            recipeIngredientViewSchema.safeParse(
                line({
                    name: 'nutritional yeast',
                    unresolvedReason: 'no_source_has_it',
                    resolutionStatus: 'NOT_FOUND',
                }),
            ).success,
        ).toBe(true);
        expect(
            recipeIngredientViewSchema.safeParse(line({ name: 'nutritional yeast', unresolvedReason: 'invented' }))
                .success,
        ).toBe(false);
    });

    it('refuses an empty name — absent is the one spelling of "no name"', () => {
        expect(recipeIngredientViewSchema.safeParse(line({ name: '' })).success).toBe(false);
    });

    it('admits a version snapshot line with no frozen name', () => {
        const parsed = recipeIngredientSchema.safeParse({
            id: '11111111-1111-4111-8111-111111111111',
            recipeId: '22222222-2222-4222-8222-222222222222',
            ingredientId: '33333333-3333-4333-8333-333333333333',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            sortOrder: 0,
            isUserEntered: false,
        });

        expect(parsed.success).toBe(true);
    });
});
