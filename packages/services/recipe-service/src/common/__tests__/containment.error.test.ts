/**
 * Unit tests for the containment denial's two doors (ADR-0040): the factory `testPrincipalContained`, and
 * `assertNotContained`, the one check-and-throw every refusing service call site issues.
 *
 * `assertNotContained` is pinned over the WHOLE `principalKind × containment × action` table, against
 * `evaluateContainment` itself rather than a restated rule, so it cannot become a second containment rule. The rows
 * that must not survive a mutant: it throws exactly for a test principal on an enforcing stage, the throw is a `403`
 * with the published code, and its message is the policy's per-action reason (so a 403 still names the write).
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { assertNotContained, testPrincipalContained } from '../containment.error.js';
import {
    CONTAINED_ACTIONS,
    PRINCIPAL_KINDS,
    TEST_PRINCIPAL_CONTAINMENT_MODES,
    evaluateContainment,
} from '../containmentPolicy.js';

describe('testPrincipalContained', () => {
    it('is a 403 carrying the published code and the given reason', () => {
        const error = testPrincipalContained('A named refusal.');

        expect(error.getStatus()).toBe(403);
        expect(error.getResponse()).toEqual({ code: 'TEST_PRINCIPAL_CONTAINED', message: 'A named refusal.' });
    });
});

describe('assertNotContained — the full truth table', () => {
    for (const principalKind of PRINCIPAL_KINDS) {
        for (const containment of TEST_PRINCIPAL_CONTAINMENT_MODES) {
            for (const action of CONTAINED_ACTIONS) {
                const decision = evaluateContainment({ principalKind, containment, action });

                it(`${principalKind} principal × ${containment} × ${action} → ${decision.allowed ? 'returns' : 'throws'}`, () => {
                    const act = (): void => assertNotContained({ principalKind, containment }, action);

                    if (decision.allowed) {
                        expect(act).not.toThrow();

                        return;
                    }

                    let thrown: unknown;

                    try {
                        act();
                    } catch (error) {
                        thrown = error;
                    }

                    expect(thrown).toBeInstanceOf(HttpException);
                    expect((thrown as HttpException).getStatus()).toBe(403);
                    expect((thrown as HttpException).getResponse()).toEqual({
                        code: 'TEST_PRINCIPAL_CONTAINED',
                        message: decision.reason,
                    });
                });
            }
        }
    }

    it('throws for exactly the test-principal × enforce rows', () => {
        const throwing = PRINCIPAL_KINDS.flatMap((principalKind) =>
            TEST_PRINCIPAL_CONTAINMENT_MODES.filter((containment) => {
                try {
                    assertNotContained({ principalKind, containment }, 'publish');

                    return false;
                } catch {
                    return true;
                }
            }).map((containment) => `${principalKind}×${containment}`),
        );

        expect(throwing).toEqual(['test×enforce']);
    });
});
