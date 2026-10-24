/**
 * The pure collection-visibility policy (owner 2026-10-13: a private collection is a Premium feature).
 *
 * Driven over the whole input space: tier x requested x current x containment. The policy is inputs-only, so no DB or DI.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import type { ContainmentSubject } from '../../../common/containmentPolicy.js';
import { defaultCollectionVisibility, evaluateCollectionVisibility } from '../collectionVisibilityPolicy.js';

const PUBLIC = RecipeVisibility.PUBLIC;
const PRIVATE = RecipeVisibility.PRIVATE;
const REAL: ContainmentSubject = { principalKind: 'real', containment: 'enforce' };
const CONTAINED: ContainmentSubject = { principalKind: 'test', containment: 'enforce' };
const TEST_UNCONTAINED: ContainmentSubject = { principalKind: 'test', containment: 'off' };

describe('defaultCollectionVisibility', () => {
    it('is PUBLIC for a free-tier cook and PRIVATE for a premium one', () => {
        expect(defaultCollectionVisibility({ ...REAL, isPremium: false })).toBe(PUBLIC);
        expect(defaultCollectionVisibility({ ...REAL, isPremium: true })).toBe(PRIVATE);
    });

    it('is PRIVATE for a contained test principal whatever its tier: a default must never be a publish nobody asked for', () => {
        expect(defaultCollectionVisibility({ ...CONTAINED, isPremium: false })).toBe(PRIVATE);
        expect(defaultCollectionVisibility({ ...CONTAINED, isPremium: true })).toBe(PRIVATE);
    });

    it('treats a test principal on a stage that does not contain as an ordinary cook', () => {
        expect(defaultCollectionVisibility({ ...TEST_UNCONTAINED, isPremium: false })).toBe(PUBLIC);
    });
});

describe('evaluateCollectionVisibility', () => {
    it('ALLOWS public for everyone', () => {
        for (const isPremium of [false, true]) {
            const decision = evaluateCollectionVisibility({ ...REAL, isPremium, requested: PUBLIC });

            expect(decision.allowed).toBe(true);
        }
    });

    it('ALLOWS private for a premium cook and DENIES it for a free-tier cook, with a reason', () => {
        expect(evaluateCollectionVisibility({ ...REAL, isPremium: true, requested: PRIVATE }).allowed).toBe(true);

        const denied = evaluateCollectionVisibility({ ...REAL, isPremium: false, requested: PRIVATE });

        expect(denied.allowed).toBe(false);
        expect(denied.reason.length).toBeGreaterThan(0);
    });

    it('gates the TRANSITION to private, never existing state: a lapsed cook keeps a collection that is already private', () => {
        expect(
            evaluateCollectionVisibility({ ...REAL, isPremium: false, requested: PRIVATE, current: PRIVATE }).allowed,
        ).toBe(true);
        expect(
            evaluateCollectionVisibility({ ...REAL, isPremium: false, requested: PRIVATE, current: PUBLIC }).allowed,
        ).toBe(false);
    });

    it('ALLOWS private for a contained test principal of any tier: private is the only state containment leaves it', () => {
        expect(evaluateCollectionVisibility({ ...CONTAINED, isPremium: false, requested: PRIVATE }).allowed).toBe(true);
    });

    it('does not let a free-tier test principal on an uncontained stage past the tier gate', () => {
        expect(
            evaluateCollectionVisibility({ ...TEST_UNCONTAINED, isPremium: false, requested: PRIVATE }).allowed,
        ).toBe(false);
    });
});
