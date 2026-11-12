/**
 * T048-test — unit tests for the pure C-004 visibility-policy evaluator.
 *
 * Pins EVERY row of the C-004 allow/deny matrix over `(sourceType, isPremium, hasAvailablePrivateSlot,
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

import {
    defaultCloneVisibility,
    evaluatePublishedState,
    evaluateVisibility,
    type VisibilityDecision,
} from '../visibilityPolicy.js';
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
                    sourceKind: null,
                    sourceType: RecipeSourceType.USER_CREATED,
                    isPremium,
                    requested: PUBLIC,
                    hasAvailablePrivateSlot: true,
                }),
                true,
            );
        }
    });

    it('ALLOWS public for imported_public', () => {
        expectDecision(
            evaluateVisibility({
                ...REAL_ENFORCING,
                sourceKind: null,
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                isPremium: false,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            }),
            true,
        );
    });

    it('DENIES public for imported_physical AND imported_paid, with DISTINCT reasons', () => {
        const physical = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceKind: null,
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            isPremium: true,
            requested: PUBLIC,
            hasAvailablePrivateSlot: true,
        });
        const paid = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceKind: null,
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            requested: PUBLIC,
            hasAvailablePrivateSlot: true,
        });

        expectDecision(physical, false);
        expectDecision(paid, false);
        // Each provenance denies with its OWN message. If the physical case fell through to paid's
        // branch (the surviving switch-case mutation), both reasons would be identical — this kills it
        // without asserting exact wording.
        expect(physical.reason).not.toBe(paid.reason);
    });
});

describe('evaluateVisibility — requested private (ADR-0073 §6, amended by ADR-0077 §6)', () => {
    /**
     * REWRITTEN for ADR-0077 section 6 (owner ruling 2026-10-29, "Any cook, using a slot"). An imported public-web
     * recipe used to need Premium AND a substantive edit, and a slot never helped. It is now private within the cook's
     * slots like every other label, so all four labels share one truth table. The table is LITERAL, not a
     * re-implementation of the rule, over every source type x tier x slot fact.
     */
    interface Row {
        readonly sourceType: RecipeSourceType;
        readonly isPremium: boolean;
        readonly hasAvailablePrivateSlot: boolean;
        readonly allowed: boolean;
        /** For a refusal: the slot refusal (`privateSlots`). No other refusal exists for a private request. */
        readonly denial?: 'privateSlots';
    }

    const TABLE: readonly Row[] = Object.values(RecipeSourceType).flatMap((sourceType): Row[] => [
        { sourceType, isPremium: true, hasAvailablePrivateSlot: true, allowed: true },
        { sourceType, isPremium: true, hasAvailablePrivateSlot: false, allowed: true },
        { sourceType, isPremium: false, hasAvailablePrivateSlot: true, allowed: true },
        { sourceType, isPremium: false, hasAvailablePrivateSlot: false, allowed: false, denial: 'privateSlots' },
    ]);

    it('covers every cell of the matrix exactly once', () => {
        expect(TABLE).toHaveLength(4 * 2 * 2);
        expect(new Set(TABLE.map((r) => `${r.sourceType}|${r.isPremium}|${r.hasAvailablePrivateSlot}`)).size).toBe(
            TABLE.length,
        );
    });

    it.each(TABLE)('%j', (row) => {
        const decision = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceKind: null,
            sourceType: row.sourceType,
            isPremium: row.isPremium,
            requested: PRIVATE,
            hasAvailablePrivateSlot: row.hasAvailablePrivateSlot,
        });

        expectDecision(decision, row.allowed);

        if (!decision.allowed) {
            // The slot refusal is a DISTINCT denial: the service maps it to 403 PRIVATE_SLOTS_FULL, never to the
            // generic 400 INVALID_VISIBILITY a cook cannot act on.
            expect(decision.denial).toBe(row.denial);
        }
    });

    it('an imported public recipe needs no Premium and no substantive edit: a free cook with a slot may keep it private', () => {
        expectDecision(
            evaluateVisibility({
                ...REAL_ENFORCING,
                sourceKind: null,
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                isPremium: false,
                requested: PRIVATE,
                hasAvailablePrivateSlot: true,
            }),
            true,
        );
    });
});

describe('evaluateVisibility — a web copy is private only (ADR-0089)', () => {
    const WEB_COPY = {
        ...REAL_ENFORCING,
        sourceType: RecipeSourceType.IMPORTED_PUBLIC,
        sourceKind: 'public_web',
    } as const;

    it.each([true, false])('DENIES public as a POLICY denial whatever the tier (premium %s)', (isPremium) => {
        const decision = evaluateVisibility({
            ...WEB_COPY,
            isPremium,
            requested: PUBLIC,
            hasAvailablePrivateSlot: true,
        });

        expectDecision(decision, false);
        expect(decision.allowed === false && decision.denial).toBe('policy');
    });

    it('gives the web copy its OWN reason, distinct from the curator text and the book and paid-site reasons', () => {
        const reasons = [
            evaluateVisibility({ ...WEB_COPY, isPremium: true, requested: PUBLIC, hasAvailablePrivateSlot: true }),
            evaluateVisibility({
                ...WEB_COPY,
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
                sourceKind: null,
                isPremium: true,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            }),
            evaluateVisibility({
                ...WEB_COPY,
                sourceType: RecipeSourceType.IMPORTED_PAID,
                sourceKind: null,
                isPremium: true,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            }),
        ].map((decision) => decision.reason);

        expect(new Set(reasons).size).toBe(3);
    });

    it('still ALLOWS public for the curator’s text, which carries the same label with no kind', () => {
        expectDecision(
            evaluateVisibility({
                ...WEB_COPY,
                sourceKind: null,
                isPremium: false,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            }),
            true,
        );
    });

    // Private goes through the slot rule unchanged: a free cook needs a slot, Premium does not.
    it.each([
        { isPremium: false, hasAvailablePrivateSlot: true, allowed: true },
        { isPremium: false, hasAvailablePrivateSlot: false, allowed: false },
        { isPremium: true, hasAvailablePrivateSlot: false, allowed: true },
    ])('private: %j', ({ isPremium, hasAvailablePrivateSlot, allowed }) => {
        const decision = evaluateVisibility({ ...WEB_COPY, isPremium, requested: PRIVATE, hasAvailablePrivateSlot });

        expectDecision(decision, allowed);
        expect(decision.allowed || decision.denial === 'privateSlots').toBe(true);
    });
});

// The state a write LEAVES (ADR-0089): a private-only recipe may never be published AND public, whatever path got it public.
describe('evaluatePublishedState — a private-only recipe is never left published and public', () => {
    const state = (over: Partial<Parameters<typeof evaluatePublishedState>[0]>) =>
        evaluatePublishedState({
            status: 'published',
            visibility: PUBLIC,
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceKind: 'public_web',
            ...over,
        });

    it('DENIES a published, public web copy, as a policy denial with a reason', () => {
        const decision = state({});

        expectDecision(decision, false);
        expect(decision.allowed === false && decision.denial).toBe('policy');
    });

    it.each([RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])('DENIES published public %s', (t) => {
        expectDecision(state({ sourceType: t, sourceKind: null }), false);
    });

    it.each([
        ['an owner-only public draft', { status: 'draft' }],
        ['a private published web copy', { visibility: PRIVATE }],
        ['the curator text, public', { sourceKind: null }],
        ['a recipe the cook wrote', { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null }],
    ] as const)('allows %s', (_name, over) => {
        expectDecision(state(over), true);
    });
});

describe('defaultCloneVisibility', () => {
    it('defaults user_created + imported_public clones to public', () => {
        expect(defaultCloneVisibility(RecipeSourceType.USER_CREATED, null, REAL_ENFORCING, PUBLIC)).toBe(PUBLIC);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PUBLIC, null, REAL_ENFORCING, PUBLIC)).toBe(PUBLIC);
    });

    it('ADR-0089: a clone of a web copy defaults to private, like a book or paid-site clone', () => {
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PUBLIC, 'public_web', REAL_ENFORCING, PUBLIC)).toBe(
            PRIVATE,
        );
    });

    it('FR-005c: a clone of a PRIVATE source (only the owner can make one) is private, whatever its label', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(defaultCloneVisibility(sourceType, null, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
        }
    });

    it('defaults imported_physical + imported_paid clones to private', () => {
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PHYSICAL, null, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PAID, null, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
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
                sourceKind: null,
                isPremium: true,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            });

            expectDecision(decision, false);
            // The denial is distinguishable from a C-004 denial, so the service answers 403 TEST_PRINCIPAL_CONTAINED
            // rather than 400 INVALID_VISIBILITY — a harness must be able to tell "contained" from "invalid".
            expect(decision.allowed === false && decision.denial).toBe('contained');
        }
    });

    it('⛔ leaves a test principal’s PRIVATE requests to the C-004 matrix, slots included (ADR-0073)', () => {
        const base = {
            principalKind: 'test',
            containment: 'enforce',
            sourceType: RecipeSourceType.USER_CREATED,
            sourceKind: null,
            requested: PRIVATE,
        } as const;
        const premium = evaluateVisibility({ ...base, isPremium: true, hasAvailablePrivateSlot: false });
        const freeWithSlot = evaluateVisibility({ ...base, isPremium: false, hasAvailablePrivateSlot: true });
        const freeNoSlot = evaluateVisibility({ ...base, isPremium: false, hasAvailablePrivateSlot: false });

        expectDecision(premium, true);
        expectDecision(freeWithSlot, true);
        expectDecision(freeNoSlot, false);
        expect(freeNoSlot.allowed === false && freeNoSlot.denial).toBe('privateSlots');
    });

    it('ALLOWS a test principal’s public request where containment is `off` (sandbox and pr-{N})', () => {
        expectDecision(
            evaluateVisibility({
                principalKind: 'test',
                containment: 'off',
                sourceType: RecipeSourceType.USER_CREATED,
                sourceKind: null,
                isPremium: false,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
            }),
            true,
        );
    });

    it('marks an ordinary C-004 denial as a POLICY denial', () => {
        const decision = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceKind: null,
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            requested: PUBLIC,
            hasAvailablePrivateSlot: true,
        });

        expect(decision.allowed === false && decision.denial).toBe('policy');
    });
});

describe('defaultCloneVisibility — test-principal containment (ADR-0040)', () => {
    it('⛔ defaults EVERY clone by a contained test principal to private — a clone default must never publish', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(
                defaultCloneVisibility(sourceType, null, { principalKind: 'test', containment: 'enforce' }, PUBLIC),
            ).toBe(PRIVATE);
        }
    });

    it('keeps the source-derived default for a test principal where containment is `off`', () => {
        expect(
            defaultCloneVisibility(
                RecipeSourceType.USER_CREATED,
                null,
                { principalKind: 'test', containment: 'off' },
                PUBLIC,
            ),
        ).toBe(PUBLIC);
    });
});
