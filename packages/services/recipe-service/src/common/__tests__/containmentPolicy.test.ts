/**
 * Unit tests for the pure test-principal CONTAINMENT policy (ADR-0040).
 *
 * Pins EVERY row of `principalKind × containment × action`. The evaluator is pure — inputs only, decision out — so
 * no DB, DI, principal object or fixture is involved.
 *
 * The rows that carry the argument, and which a mutant must not survive:
 *
 *  1. **A test principal on an ENFORCING stage is denied every action**, with the published code. That is the
 *     whole of the owner's requirement that test data "won't conflict with real data" on production.
 *  2. **A REAL principal is never contained**, on any stage, for any action. A mutant that inverted the kind
 *     check would deny every real user's publish on production — the failure a green happy path cannot see.
 *  3. **`off` contains nobody**, so sandbox and `pr-{N}` behave exactly as they did before this policy existed.
 */
import { describe, expect, it } from 'vitest';

import {
    CONTAINED_ACTIONS,
    PRINCIPAL_KINDS,
    TEST_PRINCIPAL_CONTAINED_CODE,
    TEST_PRINCIPAL_CONTAINMENT_MODES,
    corroboratorScopeFor,
    evaluateContainment,
    isContained,
    stageContains,
    type ContainedAction,
    type ContainmentSubject,
} from '../containmentPolicy.js';

describe('evaluateContainment — the full truth table', () => {
    for (const principalKind of PRINCIPAL_KINDS) {
        for (const containment of TEST_PRINCIPAL_CONTAINMENT_MODES) {
            for (const action of CONTAINED_ACTIONS) {
                const shouldDeny = principalKind === 'test' && containment === 'enforce';

                it(`${principalKind} principal × ${containment} × ${action} → ${shouldDeny ? 'DENY' : 'allow'}`, () => {
                    const decision = evaluateContainment({ principalKind, containment, action });

                    expect(decision.allowed).toBe(!shouldDeny);
                    // A reason on BOTH branches — the denial's is surfaced to the caller, the allow's is what a
                    // reviewer reads. Kills the `reason -> ''` mutant without coupling to wording.
                    expect(decision.reason.length).toBeGreaterThan(0);

                    if (!decision.allowed) {
                        expect(decision.code).toBe('TEST_PRINCIPAL_CONTAINED');
                    }
                });
            }
        }
    }
});

describe('evaluateContainment — the vocabulary is closed', () => {
    it('publishes exactly the code the wire contract carries', () => {
        expect(TEST_PRINCIPAL_CONTAINED_CODE).toBe('TEST_PRINCIPAL_CONTAINED');
    });

    it('names each contained action in its denial, so a 403 says WHICH write was refused', () => {
        const reasons = CONTAINED_ACTIONS.map(
            (action: ContainedAction) =>
                evaluateContainment({ principalKind: 'test', containment: 'enforce', action }).reason,
        );

        // Distinct per action: a single shared sentence would tell an operator nothing about which door a
        // leaked test write came through.
        expect(new Set(reasons).size).toBe(CONTAINED_ACTIONS.length);
    });

    it('contains exactly the writes ADR-0040 names, verification requests included', () => {
        // Pinned as a set, so an action silently dropped from the tuple — which would stop every composed policy and
        // seam that names it from compiling only if it is still referenced — fails here first.
        expect([...CONTAINED_ACTIONS].sort()).toEqual(
            [
                'cloneForeign',
                'eraseAccount',
                'promoteCorrection',
                'publish',
                'rate',
                'recordAnalytics',
                'requestVerification',
            ].sort(),
        );
    });

    it('contains exactly the two kinds and two modes the owner ruled (2026-09-13)', () => {
        expect([...PRINCIPAL_KINDS].sort()).toEqual(['real', 'test']);
        expect([...TEST_PRINCIPAL_CONTAINMENT_MODES].sort()).toEqual(['enforce', 'off']);
    });
});

describe('isContained', () => {
    it('is the boolean projection of the same rule, never a second one', () => {
        for (const principalKind of PRINCIPAL_KINDS) {
            for (const containment of TEST_PRINCIPAL_CONTAINMENT_MODES) {
                expect(isContained({ principalKind, containment })).toBe(
                    !evaluateContainment({ principalKind, containment, action: 'publish' }).allowed,
                );
            }
        }
    });
});

describe('stageContains', () => {
    it('is the STAGE half of the same rule: true exactly when the stage enforces, whoever is asking', () => {
        for (const principalKind of PRINCIPAL_KINDS) {
            for (const containment of TEST_PRINCIPAL_CONTAINMENT_MODES) {
                // A whole subject, as every call site passes a principal: the projection must IGNORE the kind. It is
                // pinned against the evaluator for a TEST subject — a test principal is contained exactly when its
                // stage contains — so a REAL caller's corroborator read on production excludes test rows too.
                const subject: ContainmentSubject = { principalKind, containment };

                expect(stageContains(subject)).toBe(isContained({ principalKind: 'test', containment }));
            }
        }
    });

    it('builds the corroborator scope the correction DALs require from the same projection', () => {
        const realOnProduction: ContainmentSubject = { principalKind: 'real', containment: 'enforce' };
        const testOnSandbox: ContainmentSubject = { principalKind: 'test', containment: 'off' };

        expect(corroboratorScopeFor(realOnProduction)).toEqual({ excludeTestPrincipals: true });
        expect(corroboratorScopeFor(testOnSandbox)).toEqual({ excludeTestPrincipals: false });
    });
});
