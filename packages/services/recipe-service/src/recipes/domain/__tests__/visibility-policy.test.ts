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

import { defaultCloneVisibility, evaluateVisibility } from '../visibility-policy.js';

const PUBLIC = RecipeVisibility.PUBLIC;
const PRIVATE = RecipeVisibility.PRIVATE;

describe('evaluateVisibility — requested public', () => {
    it('ALLOWS public for user_created (free or premium)', () => {
        for (const isPremium of [false, true]) {
            const decision = evaluateVisibility({
                sourceType: RecipeSourceType.USER_CREATED,
                isPremium,
                hasSubstantiveEdit: false,
                requested: PUBLIC,
            });

            expect(decision.allowed).toBe(true);
        }
    });

    it('ALLOWS public for imported_public', () => {
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PUBLIC,
        });

        expect(decision.allowed).toBe(true);
    });

    it('DENIES public for imported_physical (private-only)', () => {
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason.length).toBeGreaterThan(0);
    });

    it('DENIES public for imported_paid (private-only, permanent — may NEVER be public)', () => {
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            hasSubstantiveEdit: true,
            requested: PUBLIC,
        });

        expect(decision.allowed).toBe(false);
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

        expect(premium.allowed).toBe(true);
        expect(free.allowed).toBe(false);
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

        expect(both.allowed).toBe(true);
        expect(premiumNoEdit.allowed).toBe(false);
        expect(editNoPremium.allowed).toBe(false);
    });

    it('imported_physical: ALLOWS private (private-only anyway), regardless of tier/edit', () => {
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });

        expect(decision.allowed).toBe(true);
    });

    it('imported_paid: ALLOWS private (private-only, permanent), regardless of tier/edit', () => {
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
        });

        expect(decision.allowed).toBe(true);
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
