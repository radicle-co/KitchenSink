/**
 * The test-principal containment Specification (ADR-0040), over its WHOLE input space.
 *
 * A test principal is a member of the fixed Clerk test pool, marked by the signed claim
 * `public_metadata.testPrincipal === true`. Erasing or closing its identity account deletes or bans a pool user
 * in Clerk, and R10 anti-resurrection then makes that pool member unusable forever — so under `enforce` the two
 * lifecycle actions are refused for it. The table below is exhaustive (2 × 2 × 2), so a mutation that drops
 * either conjunct of "denied iff testPrincipal AND enforce", or inverts the mode comparison, fails a row.
 */
import { describe, expect, it } from 'vitest';

import {
    CONTAINED_ACTIONS,
    TEST_PRINCIPAL_CONTAINED,
    evaluateTestPrincipalContainment,
    type ContainedAction,
} from '../domain/testPrincipalContainment.js';
import type { TestPrincipalContainment } from '../../config/env.schema.js';

const MODES: readonly TestPrincipalContainment[] = ['enforce', 'off'];

describe('evaluateTestPrincipalContainment', () => {
    const rows = CONTAINED_ACTIONS.flatMap((action) =>
        MODES.flatMap((containment) =>
            [true, false].map((testPrincipal) => ({
                action,
                containment,
                testPrincipal,
                denied: testPrincipal && containment === 'enforce',
            })),
        ),
    );

    it('covers every action × mode × principal combination', () => {
        expect(CONTAINED_ACTIONS).toStrictEqual(['eraseAccount', 'closeAccount']);
        expect(rows).toHaveLength(8);
    });

    it.each(rows)(
        '$action by testPrincipal=$testPrincipal under $containment → denied=$denied',
        ({ action, containment, testPrincipal, denied }) => {
            const decision = evaluateTestPrincipalContainment({ action, containment, testPrincipal });

            if (denied) {
                expect(decision).toStrictEqual({
                    allowed: false,
                    code: TEST_PRINCIPAL_CONTAINED,
                    reason: expect.any(String),
                });
            } else {
                expect(decision).toStrictEqual({ allowed: true });
            }
        },
    );

    it('publishes the code the error envelope carries, spelled exactly', () => {
        expect(TEST_PRINCIPAL_CONTAINED).toBe('TEST_PRINCIPAL_CONTAINED');
    });

    it.each<ContainedAction>(['eraseAccount', 'closeAccount'])(
        'names the refused action (%s) in the reason, so the two denials are distinguishable in a log',
        (action) => {
            const decision = evaluateTestPrincipalContainment({ action, containment: 'enforce', testPrincipal: true });

            expect(decision.allowed).toBe(false);

            if (!decision.allowed) {
                expect(decision.reason).toContain(action);
            }
        },
    );
});
