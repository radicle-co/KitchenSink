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
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
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
            hasAvailablePrivateSlot: true,
        });
        const paid = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: RecipeSourceType.IMPORTED_PAID,
            isPremium: true,
            hasSubstantiveEdit: true,
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

describe('evaluateVisibility — requested private (ADR-0073 §6 truth table)', () => {
    /**
     * REWRITTEN for ADR-0073. It used to assert that a free user_created private request is denied outright and that
     * imported_physical/imported_paid are always allowed. It now proves the §6 matrix cell by cell, against a LITERAL
     * table (not a re-implementation of the rule), over every source type x tier x slot fact x substantive edit.
     */
    interface Row {
        readonly sourceType: RecipeSourceType;
        readonly isPremium: boolean;
        readonly hasAvailablePrivateSlot: boolean;
        readonly hasSubstantiveEdit: boolean;
        readonly allowed: boolean;
        /** For a refusal: whether it is the slot refusal (`privateSlots`) or an ordinary policy refusal. */
        readonly denial?: 'policy' | 'privateSlots';
    }

    const UC = RecipeSourceType.USER_CREATED;
    const IP = RecipeSourceType.IMPORTED_PUBLIC;
    const PH = RecipeSourceType.IMPORTED_PHYSICAL;
    const PD = RecipeSourceType.IMPORTED_PAID;

    const TABLE: readonly Row[] = [
        // user_created / imported_physical / imported_paid: Premium, or a free slot. The edit flag never matters.
        ...[UC, PH, PD].flatMap((sourceType): Row[] =>
            [false, true].flatMap((hasSubstantiveEdit): Row[] => [
                { sourceType, isPremium: true, hasAvailablePrivateSlot: true, hasSubstantiveEdit, allowed: true },
                { sourceType, isPremium: true, hasAvailablePrivateSlot: false, hasSubstantiveEdit, allowed: true },
                { sourceType, isPremium: false, hasAvailablePrivateSlot: true, hasSubstantiveEdit, allowed: true },
                {
                    sourceType,
                    isPremium: false,
                    hasAvailablePrivateSlot: false,
                    hasSubstantiveEdit,
                    allowed: false,
                    denial: 'privateSlots',
                },
            ]),
        ),
        // imported_public: Premium AND a substantive edit. A slot never helps, and a missing one is never the reason.
        { sourceType: IP, isPremium: true, hasAvailablePrivateSlot: true, hasSubstantiveEdit: true, allowed: true },
        { sourceType: IP, isPremium: true, hasAvailablePrivateSlot: false, hasSubstantiveEdit: true, allowed: true },
        {
            sourceType: IP,
            isPremium: true,
            hasAvailablePrivateSlot: true,
            hasSubstantiveEdit: false,
            allowed: false,
            denial: 'policy',
        },
        {
            sourceType: IP,
            isPremium: true,
            hasAvailablePrivateSlot: false,
            hasSubstantiveEdit: false,
            allowed: false,
            denial: 'policy',
        },
        {
            sourceType: IP,
            isPremium: false,
            hasAvailablePrivateSlot: true,
            hasSubstantiveEdit: true,
            allowed: false,
            denial: 'policy',
        },
        {
            sourceType: IP,
            isPremium: false,
            hasAvailablePrivateSlot: true,
            hasSubstantiveEdit: false,
            allowed: false,
            denial: 'policy',
        },
        {
            sourceType: IP,
            isPremium: false,
            hasAvailablePrivateSlot: false,
            hasSubstantiveEdit: true,
            allowed: false,
            denial: 'policy',
        },
        {
            sourceType: IP,
            isPremium: false,
            hasAvailablePrivateSlot: false,
            hasSubstantiveEdit: false,
            allowed: false,
            denial: 'policy',
        },
    ];

    it('covers every cell of the matrix exactly once', () => {
        expect(TABLE).toHaveLength(4 * 2 * 2 * 2);
        expect(
            new Set(
                TABLE.map((r) => `${r.sourceType}|${r.isPremium}|${r.hasAvailablePrivateSlot}|${r.hasSubstantiveEdit}`),
            ).size,
        ).toBe(TABLE.length);
    });

    it.each(TABLE)('%j', (row) => {
        const decision = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: row.sourceType,
            isPremium: row.isPremium,
            hasSubstantiveEdit: row.hasSubstantiveEdit,
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

    it('the slot refusal and the Premium refusal explain themselves differently', () => {
        const noSlot = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: UC,
            isPremium: false,
            hasSubstantiveEdit: false,
            requested: PRIVATE,
            hasAvailablePrivateSlot: false,
        });
        const noPremium = evaluateVisibility({
            ...REAL_ENFORCING,
            sourceType: IP,
            isPremium: false,
            hasSubstantiveEdit: true,
            requested: PRIVATE,
            hasAvailablePrivateSlot: true,
        });

        expect(noSlot.reason).not.toBe(noPremium.reason);
    });
});

describe('defaultCloneVisibility', () => {
    it('defaults user_created + imported_public clones to public', () => {
        expect(defaultCloneVisibility(RecipeSourceType.USER_CREATED, REAL_ENFORCING, PUBLIC)).toBe(PUBLIC);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PUBLIC, REAL_ENFORCING, PUBLIC)).toBe(PUBLIC);
    });

    it('FR-005c: a clone of a PRIVATE source (only the owner can make one) is private, whatever its label', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(defaultCloneVisibility(sourceType, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
        }
    });

    it('defaults imported_physical + imported_paid clones to private', () => {
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PHYSICAL, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
        expect(defaultCloneVisibility(RecipeSourceType.IMPORTED_PAID, REAL_ENFORCING, PRIVATE)).toBe(PRIVATE);
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
            hasSubstantiveEdit: false,
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
                isPremium: false,
                hasSubstantiveEdit: false,
                requested: PUBLIC,
                hasAvailablePrivateSlot: true,
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
            hasAvailablePrivateSlot: true,
        });

        expect(decision.allowed === false && decision.denial).toBe('policy');
    });
});

describe('defaultCloneVisibility — test-principal containment (ADR-0040)', () => {
    it('⛔ defaults EVERY clone by a contained test principal to private — a clone default must never publish', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(defaultCloneVisibility(sourceType, { principalKind: 'test', containment: 'enforce' }, PUBLIC)).toBe(
                PRIVATE,
            );
        }
    });

    it('keeps the source-derived default for a test principal where containment is `off`', () => {
        expect(
            defaultCloneVisibility(
                RecipeSourceType.USER_CREATED,
                { principalKind: 'test', containment: 'off' },
                PUBLIC,
            ),
        ).toBe(PUBLIC);
    });
});
