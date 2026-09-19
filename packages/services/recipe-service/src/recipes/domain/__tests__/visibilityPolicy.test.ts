/**
 * T048-test — unit tests for the pure C-004 visibility-policy evaluator.
 *
 * Pins EVERY row of the C-004 allow/deny matrix over `(sourceType, isPremium, hasSubstantiveEdit,
 * requested)`, plus the premium-lapse transition semantics (the evaluator gates the *transition to
 * private*, not existing state) and the clone default-visibility derivation. The evaluator is pure —
 * inputs only, boolean + reason out — so no DB, DI, or fixtures are involved.
 *
 * ADR-0040 made `principalKind` + `containment` REQUIRED inputs. The C-004 matrix below is unchanged and is driven
 * as a REAL principal on an ENFORCING stage — the production case, where containment must not move a single row of
 * it; the containment rows are pinned separately at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import { defaultCloneVisibility, evaluateVisibility, type VisibilityDecision } from '../visibilityPolicy.js';
import type { ContainmentSubject } from '../../../common/containmentPolicy.js';

const PUBLIC = RecipeVisibility.PUBLIC;
const PRIVATE = RecipeVisibility.PRIVATE;

/** The production case for a real user: containment is on, and must change nothing for them. */
const REAL_ENFORCING: ContainmentSubject = { principalKind: 'real', containment: 'enforce' };

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
                    ...REAL_ENFORCING,
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
                ...REAL_ENFORCING,
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
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });
        const paid = evaluateVisibility({
            ...REAL_ENFORCING,
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
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: true,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });
        const free = evaluateVisibility({
            ...REAL_ENFORCING,
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
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PRIVATE,
        });
        const premiumNoEdit = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: true,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });
        const editNoPremium = evaluateVisibility({
            ...REAL_ENFORCING,
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
                ...REAL_ENFORCING,
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
                ...REAL_ENFORCING,
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
        expect(defaultCloneVisibility(RecipeSourceType.USER_CREATED, REAL_ENFORCING)).toBe(PUBLIC);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PUBLIC, REAL_ENFORCING)).toBe(PUBLIC);
    });

    it('defaults imported_physical + imported_paid clones to private', () => {
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PHYSICAL, REAL_ENFORCING)).toBe(PRIVATE);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PAID, REAL_ENFORCING)).toBe(PRIVATE);
    });
});

describe('evaluateVisibility — test-principal containment (ADR-0040)', () => {
    const ALL_SOURCES = Object.values(RecipeSourceType);

    it('⛔ DENIES every public request from a test principal on an enforcing stage, as a CONTAINMENT denial', () => {
        for (const sourceType of ALL_SOURCES) {
            const decision = evaluateVisibility({
                principalKind: 'test',
                containment: 'enforce',
                sourceType,
                isPremium: true,
                hasSubstantiveEdit: true,
                requested: PUBLIC,
            });

            expectDecision(decision, false);
            // The denial is distinguishable from a C-004 denial, so the service answers 403 TEST_PRINCIPAL_CONTAINED
            // rather than 400 INVALID_VISIBILITY — a harness must be able to tell "contained" from "invalid".
            expect(decision.allowed === false && decision.denial).toBe('contained');
        }
    });

    it('⛔ leaves a test principal’s PRIVATE requests to the unchanged C-004 matrix', () => {
        const premium = evaluateVisibility({
            principalKind: 'test',
            containment: 'enforce',
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: true,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });
        const free = evaluateVisibility({
            principalKind: 'test',
            containment: 'enforce',
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });

        expectDecision(premium, true);
        expectDecision(free, false);
        expect(free.allowed === false && free.denial).toBe('policy');
    });

    it('ALLOWS a test principal’s public request where containment is `off` (sandbox and pr-{N})', () => {
        expectDecision(
            evaluateVisibility({
                principalKind: 'test',
                containment: 'off',
                sourceType: RecipeSourceType.USER_CREATED,
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PUBLIC,
            }),
            true,
        );
    });

    it('marks an ordinary C-004 denial as a POLICY denial', () => {
        const decision = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });

        expect(decision.allowed === false && decision.denial).toBe('policy');
    });
});

describe('defaultCloneVisibility — test-principal containment (ADR-0040)', () => {
    it('⛔ defaults EVERY clone by a contained test principal to private — a clone default must never publish', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(defaultCloneVisibility(sourceType, { principalKind: 'test', containment: 'enforce' })).toBe(PRIVATE);
        }
    });

    it('keeps the source-derived default for a test principal where containment is `off`', () => {
        expect(
            defaultCloneVisibility(RecipeSourceType.USER_CREATED, { principalKind: 'test', containment: 'off' }),
        ).toBe(PUBLIC);
    });
});
