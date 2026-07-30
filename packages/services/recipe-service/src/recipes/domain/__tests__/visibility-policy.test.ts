/**
 * T048-test — unit tests for the pure C-004 visibility-policy evaluator.
 *
 * Pins EVERY row of the C-004 allow/deny matrix over `(sourceType, isPremium, hasSubstantiveEdit,
 * requested)`, plus the premium-lapse transition semantics (the evaluator gates the *transition to
 * private*, not existing state) and the clone default-visibility derivation. The evaluator is pure —
 * inputs only, boolean + reason out — so no DB, DI, or fixtures are involved.
 */
import { describe, it, expect } from 'vitest';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import { defaultCloneVisibility, evaluateVisibility, type VisibilityDecision } from '../visibility-policy.js';

const PUBLIC = RecipeVisibility.PUBLIC;
const PRIVATE = RecipeVisibility.PRIVATE;

/**
 * Assert a decision's `allowed` value AND that it carries a non-empty reason. The reason check kills the
 * "reason → ''" mutants: every allow/deny MUST explain itself (the reason is surfaced as the user-facing
 * error message on denial), without coupling the test to exact wording.
 */
function expectDecision(decision: VisibilityDecision, allowed: boolean): void {
    expect(decision.allowed).toBe(allowed);
    expect(decision.reason.length).toBeGreaterThan(0);
}

describe('evaluateVisibility — requested public', () => {
    it('ALLOWS public for user_created (free or premium)', () => {
        for (const isPremium of [false, true]) {
            expectDecision(
                evaluateVisibility({
                    sourceType: RecipeSourceType.USER_CREATED,
                    isPremium,
                    hasSubstantiveEdit: false,
                    requested: PUBLIC,
                }),
                true,
            );
        }
    });

    it('ALLOWS public for imported_public', () => {
        expectDecision(
            evaluateVisibility({
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PUBLIC,
            }),
            true,
        );
    });

    it('DENIES public for imported_physical AND imported_paid, with DISTINCT reasons', () => {
        const physical = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });
        const paid = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });

        expectDecision(physical, false);
        expectDecision(paid, false);
        // Each provenance denies with its OWN message. If the physical case fell through to paid's
        // branch (the surviving switch-case mutation), both reasons would be identical — this kills it
        // without asserting exact wording.
        expect(physical.reason).not.toBe(paid.reason);
    });
});

describe('evaluateVisibility — requested private', () => {
    it('user_created: ALLOWS private only for premium (free-tier is public-only)', () => {
        const premium = evaluateVisibility({
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: true,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });
        const free = evaluateVisibility({
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });

        expectDecision(premium, true);
        expectDecision(free, false);
    });

    it('imported_public: ALLOWS private only when premium AND hasSubstantiveEdit', () => {
        const both = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PRIVATE,
        });
        const premiumNoEdit = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: true,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });
        const editNoPremium = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: false,
            hasSubstantiveEdit: true,
            requested: PRIVATE,
        });

        expectDecision(both, true);
        expectDecision(premiumNoEdit, false);
        expectDecision(editNoPremium, false);
    });

    it('imported_physical: ALLOWS private (private-only anyway), regardless of tier/edit', () => {
        expectDecision(
            evaluateVisibility({
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PRIVATE,
            }),
            true,
        );
    });

    it('imported_paid: ALLOWS private (private-only, permanent), regardless of tier/edit', () => {
        expectDecision(
            evaluateVisibility({
                sourceType: RecipeSourceType.IMPORTED_PAID,
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PRIVATE,
            }),
            true,
        );
    });
});

describe('defaultCloneVisibility', () => {
    it('defaults user_created + imported_public clones to public', () => {
        expect(defaultCloneVisibility(RecipeSourceType.USER_CREATED)).toBe(PUBLIC);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PUBLIC)).toBe(PUBLIC);
    });

    it('defaults imported_physical + imported_paid clones to private', () => {
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PHYSICAL)).toBe(PRIVATE);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PAID)).toBe(PRIVATE);
    });
});
